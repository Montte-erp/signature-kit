/**
 * RFC 3161 timestamp client for PAdES-T / CAdES-T (ICP-Brasil AD-RT).
 *
 * `requestTimestamp` hashes the bytes to be timestamped (the SignerInfo signature
 * value for CAdES-T), asks the TSA for a token over that imprint, and returns the
 * timeStampToken ContentInfo DER. The caller embeds it as the unsigned attribute
 * id-aa-timeStampToken (…16.2.14) on the SignerInfo.
 */

import * as asn1js from "asn1js";
import { Duration, Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import {
  CmsError,
  CmsErrorCodeValue,
  CmsHashAlgorithmSchema,
  CmsOperationValue,
  hashAlgorithmOid,
} from "./config";
import { digest, toArrayBuffer } from "./engine";

const TSA_CONTENT_TYPE = "application/timestamp-query";
const DEFAULT_TIMEOUT_MILLIS = 15000;

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const timestampNonce = (): asn1js.Integer => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  return new asn1js.Integer({ valueHex: toArrayBuffer(bytes) });
};

const RequestTimestampInputSchema = Schema.Struct({
  data: Schema.Uint8Array,
  tsaUrl: Schema.NonEmptyString,
  hashAlgorithm: CmsHashAlgorithmSchema,
  timeoutMillis: Schema.optional(Schema.Number),
});
type RequestTimestampInput = (typeof RequestTimestampInputSchema)["Type"];

export const requestTimestamp = (
  input: RequestTimestampInput,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(RequestTimestampInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.timestampError,
            reason: `Invalid RFC 3161 timestamp input: ${String(issue)}`,
            operation: CmsOperationValue.timestamp,
          }),
      ),
    );
    const imprint = yield* digest(valid.hashAlgorithm, valid.data);
    const nonce = timestampNonce();

    const requestDer = yield* Effect.try({
      try: () => {
        const request = new pkijs.TimeStampReq({
          version: 1,
          messageImprint: new pkijs.MessageImprint({
            hashAlgorithm: new pkijs.AlgorithmIdentifier({
              algorithmId: hashAlgorithmOid(valid.hashAlgorithm),
            }),
            hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(imprint) }),
          }),
          nonce,
          certReq: true,
        });
        return new Uint8Array(request.toSchema().toBER(false));
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to encode the RFC 3161 request.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(valid.tsaUrl, {
          method: "POST",
          headers: { "content-type": TSA_CONTENT_TYPE },
          body: requestDer,
          signal,
        }),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA request to ${valid.tsaUrl} failed.`,
          operation: CmsOperationValue.timestamp,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(valid.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS),
        orElse: () =>
          Effect.fail(
            new CmsError({
              code: CmsErrorCodeValue.timestampError,
              reason: `TSA request to ${valid.tsaUrl} timed out.`,
              operation: CmsOperationValue.timestamp,
            }),
          ),
      }),
    );

    if (!response.ok) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA request to ${valid.tsaUrl} failed with HTTP ${response.status}.`,
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const responseBytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to read the TSA response.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    const parsed = yield* Effect.try({
      try: () => {
        const tsaResponse = pkijs.TimeStampResp.fromBER(responseBytes);
        const token = tsaResponse.timeStampToken;
        if (token === undefined) {
          return {
            status: tsaResponse.status.status,
            token: undefined,
            tstInfo: undefined,
          };
        }
        const signed = new pkijs.SignedData({ schema: token.content });
        const eContent = signed.encapContentInfo.eContent;
        if (eContent === undefined) {
          return {
            status: tsaResponse.status.status,
            token,
            tstInfo: undefined,
          };
        }
        const eContentBytes =
          eContent.valueBlock.valueHexView.byteLength === 0
            ? new Uint8Array(eContent.getValue())
            : eContent.valueBlock.valueHexView;
        return {
          status: tsaResponse.status.status,
          token,
          tstInfo: pkijs.TSTInfo.fromBER(toArrayBuffer(eContentBytes)),
        };
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to parse the TSA response.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    if (
      parsed.status !== pkijs.PKIStatus.granted &&
      parsed.status !== pkijs.PKIStatus.grantedWithMods
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA did not grant a timestamp token; PKIStatus=${parsed.status}.`,
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (parsed.token === undefined || parsed.tstInfo === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA did not return a timestamp token with TSTInfo.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (!parsed.tstInfo.nonce?.isEqual(nonce)) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp nonce does not match the request.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (
      parsed.tstInfo.messageImprint.hashAlgorithm.algorithmId !==
        hashAlgorithmOid(valid.hashAlgorithm) ||
      !bytesEqual(parsed.tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView, imprint)
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp message imprint does not match the request.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    return new Uint8Array(parsed.token.toSchema().toBER(false));
  });
