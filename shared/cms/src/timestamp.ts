/**
 * RFC 3161 timestamp client for PAdES-T / CAdES-T (ICP-Brasil AD-RT).
 *
 * `requestTimestamp` hashes the bytes to be timestamped (the SignerInfo signature
 * value for CAdES-T), asks the TSA for a token over that imprint, and returns the
 * timeStampToken ContentInfo DER. The caller embeds it as the unsigned attribute
 * id-aa-timeStampToken (…16.2.14) on the SignerInfo.
 */

import * as asn1js from "asn1js";
import { Duration, Effect } from "effect";
import * as pkijs from "pkijs";
import {
  type CmsHashAlgorithm,
  CmsError,
  CmsErrorCodeValue,
  CmsOperationValue,
  hashAlgorithmOid,
  safeCauseMetadata,
} from "./config";
import { digest, toArrayBuffer } from "./engine";

const TSA_CONTENT_TYPE = "application/timestamp-query";
const DEFAULT_TIMEOUT_MILLIS = 15000;

export const requestTimestamp = (input: {
  readonly data: Uint8Array;
  readonly tsaUrl: string;
  readonly hashAlgorithm: CmsHashAlgorithm;
  readonly timeoutMillis?: number | undefined;
}): Effect.Effect<Uint8Array, CmsError> =>
  Effect.gen(function* () {
    const imprint = yield* digest(input.hashAlgorithm, input.data);

    const requestDer = yield* Effect.try({
      try: () => {
        const request = new pkijs.TimeStampReq({
          version: 1,
          messageImprint: new pkijs.MessageImprint({
            hashAlgorithm: new pkijs.AlgorithmIdentifier({
              algorithmId: hashAlgorithmOid(input.hashAlgorithm),
            }),
            hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(imprint) }),
          }),
          certReq: true,
        });
        return new Uint8Array(request.toSchema().toBER(false));
      },
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to encode the RFC 3161 request.",
          operation: CmsOperationValue.timestamp,
          ...safeCauseMetadata(cause),
        }),
    });

    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(input.tsaUrl, {
          method: "POST",
          headers: { "content-type": TSA_CONTENT_TYPE },
          body: requestDer,
          signal,
        }),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA request to ${input.tsaUrl} failed.`,
          operation: CmsOperationValue.timestamp,
          ...safeCauseMetadata(cause),
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(input.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS),
        orElse: () =>
          Effect.fail(
            new CmsError({
              code: CmsErrorCodeValue.timestampError,
              reason: `TSA request to ${input.tsaUrl} timed out.`,
              operation: CmsOperationValue.timestamp,
            }),
          ),
      }),
    );

    if (!response.ok) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA request to ${input.tsaUrl} failed with HTTP ${response.status}.`,
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const responseBytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to read the TSA response.",
          operation: CmsOperationValue.timestamp,
          ...safeCauseMetadata(cause),
        }),
    });

    return yield* Effect.try({
      try: () => {
        const response = pkijs.TimeStampResp.fromBER(responseBytes);
        const token = response.timeStampToken;
        if (token === undefined) {
          return undefined;
        }
        return new Uint8Array(token.toSchema().toBER(false));
      },
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to parse the TSA response.",
          operation: CmsOperationValue.timestamp,
          ...safeCauseMetadata(cause),
        }),
    }).pipe(
      Effect.flatMap((token) =>
        token === undefined
          ? Effect.fail(
              new CmsError({
                code: CmsErrorCodeValue.timestampError,
                reason: "TSA did not grant a timestamp token.",
                operation: CmsOperationValue.timestamp,
              }),
            )
          : Effect.succeed(token),
      ),
    );
  });
