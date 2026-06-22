/**
 * createDetachedSignedData — build a detached CMS/PKCS#7 SignedData (ContentInfo)
 * over arbitrary bytes, signed with a WebCrypto `CryptoKey`. The cryptographic
 * core that PAdES embeds and CAdES reuses.
 *
 * Detached: EncapsulatedContentInfo carries the id-data OID with no eContent; the
 * content bytes are passed to `sign(...)` and again to `verify(...)`.
 */

import * as asn1js from "asn1js";
import { Effect } from "effect";
import * as pkijs from "pkijs";
import { buildSignedAttributes } from "./attributes";
import {
  type CreateDetachedSignedDataInput,
  CmsError,
  CmsErrorCodeValue,
  CmsOid,
  CmsOperationValue,
  safeCauseMetadata,
  webCryptoHashName,
} from "./config";
import { digest, toArrayBuffer, toBufferSource } from "./engine";
import { requestTimestamp } from "./timestamp";

export const createDetachedSignedData = (
  input: CreateDetachedSignedDataInput,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.gen(function* () {
    const hashAlgorithm = input.hashAlgorithm ?? "sha256";
    const signingTime = input.signingTime ?? new Date();

    const certificate = yield* Effect.try({
      try: () => pkijs.Certificate.fromBER(toArrayBuffer(input.certificateDer)),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the signer certificate DER.",
          operation: CmsOperationValue.parse,
          ...safeCauseMetadata(cause),
        }),
    });

    const chain = yield* Effect.try({
      try: () => (input.chainDer ?? []).map((der) => pkijs.Certificate.fromBER(toArrayBuffer(der))),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse a chain certificate DER.",
          operation: CmsOperationValue.parse,
          ...safeCauseMetadata(cause),
        }),
    });

    const messageDigest = yield* digest(hashAlgorithm, input.content);
    const certificateSha256 = yield* digest("sha256", input.certificateDer);

    const signed = yield* Effect.try({
      try: () =>
        new pkijs.SignedData({
          version: 1,
          encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: CmsOid.data }),
          signerInfos: [
            new pkijs.SignerInfo({
              version: 1,
              sid: new pkijs.IssuerAndSerialNumber({
                issuer: certificate.issuer,
                serialNumber: certificate.serialNumber,
              }),
              signedAttrs: new pkijs.SignedAndUnsignedAttributes({
                type: 0,
                attributes: [
                  ...buildSignedAttributes({
                    messageDigest,
                    signingTime,
                    certificateSha256,
                    icpBrasil: input.icpBrasil,
                  }),
                ],
              }),
            }),
          ],
          certificates: [certificate, ...chain],
        }),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.encodeError,
          reason: "Failed to assemble the CMS SignedData.",
          operation: CmsOperationValue.encode,
          ...safeCauseMetadata(cause),
        }),
    });

    yield* Effect.tryPromise({
      try: () =>
        signed.sign(
          input.signingKey,
          0,
          webCryptoHashName(hashAlgorithm),
          toBufferSource(input.content),
        ),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.signError,
          reason: "Web Crypto signing of the CMS attributes failed.",
          operation: CmsOperationValue.sign,
          ...safeCauseMetadata(cause),
        }),
    });

    if (input.timestamp !== undefined) {
      const signerInfo = signed.signerInfos[0];
      if (signerInfo === undefined) {
        return yield* Effect.fail(
          new CmsError({
            code: CmsErrorCodeValue.encodeError,
            reason: "CMS SignedData has no signer info for timestamp embedding.",
            operation: CmsOperationValue.encode,
          }),
        );
      }
      const signatureValue = signerInfo.signature.valueBlock.valueHexView;
      const tokenDer = yield* requestTimestamp({
        data: signatureValue,
        tsaUrl: input.timestamp.tsaUrl,
        hashAlgorithm: input.timestamp.hashAlgorithm ?? "sha256",
        timeoutMillis: input.timestamp.timeoutMillis,
      });
      yield* Effect.try({
        try: () => {
          signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
            type: 1,
            attributes: [
              new pkijs.Attribute({
                type: CmsOid.timeStampToken,
                values: [asn1js.fromBER(toArrayBuffer(tokenDer)).result],
              }),
            ],
          });
          return undefined;
        },
        catch: (cause) =>
          new CmsError({
            code: CmsErrorCodeValue.encodeError,
            reason: "Failed to embed the timestamp token.",
            operation: CmsOperationValue.encode,
            ...safeCauseMetadata(cause),
          }),
      });
    }

    return yield* Effect.try({
      try: () => {
        const contentInfo = new pkijs.ContentInfo({
          contentType: CmsOid.signedData,
          content: signed.toSchema(true),
        });
        return new Uint8Array(contentInfo.toSchema().toBER(false));
      },
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.encodeError,
          reason: "Failed to serialize the CMS ContentInfo.",
          operation: CmsOperationValue.encode,
          ...safeCauseMetadata(cause),
        }),
    });
  });
