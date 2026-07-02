/**
 * createDetachedSignedData — build a detached CMS/PKCS#7 SignedData (ContentInfo)
 * over arbitrary bytes, signed with a WebCrypto `CryptoKey`. The cryptographic
 * core that PAdES embeds and CAdES reuses.
 *
 * Detached: EncapsulatedContentInfo carries the id-data OID with no eContent; the
 * content bytes are passed to `sign(...)` and again to `verify(...)`.
 */

import * as asn1js from "asn1js";
import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import { buildSignedAttributes } from "./attributes";
import {
  type CreateDetachedSignedDataInput,
  CreateDetachedSignedDataInputSchema,
  CmsError,
  CmsErrorCodeValue,
  CmsOid,
  CmsOperationValue,
  webCryptoHashName,
} from "./config";
import { digest, toArrayBuffer, toBufferSource } from "./engine";
import { requestTimestamp } from "./timestamp";

export const createDetachedSignedData = (
  input: CreateDetachedSignedDataInput,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(CreateDetachedSignedDataInputSchema)(
      input,
    ).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.signError,
            reason: `Invalid CMS signing input: ${String(issue)}`,
            operation: CmsOperationValue.sign,
          }),
      ),
    );
    const hashAlgorithm = valid.hashAlgorithm ?? "sha256";
    const signingTime = valid.signingTime ?? new Date();

    const certificate = yield* Effect.try({
      try: () => pkijs.Certificate.fromBER(toArrayBuffer(valid.certificateDer)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the signer certificate DER.",
          operation: CmsOperationValue.parse,
        }),
    });

    const chain = yield* Effect.try({
      try: () => (valid.chainDer ?? []).map((der) => pkijs.Certificate.fromBER(toArrayBuffer(der))),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse a chain certificate DER.",
          operation: CmsOperationValue.parse,
        }),
    });

    const messageDigest = yield* digest(hashAlgorithm, valid.content);
    const certificateSha256 = yield* digest("sha256", valid.certificateDer);

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
                    icpBrasil: valid.icpBrasil,
                  }),
                ],
              }),
            }),
          ],
          certificates: [certificate, ...chain],
        }),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.encodeError,
          reason: "Failed to assemble the CMS SignedData.",
          operation: CmsOperationValue.encode,
        }),
    });

    yield* Effect.tryPromise({
      try: () =>
        signed.sign(
          valid.signingKey,
          0,
          webCryptoHashName(hashAlgorithm),
          toBufferSource(valid.content),
        ),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.signError,
          reason: "Web Crypto signing of the CMS attributes failed.",
          operation: CmsOperationValue.sign,
        }),
    });

    if (valid.timestamp !== undefined) {
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
        tsaUrl: valid.timestamp.tsaUrl,
        hashAlgorithm: valid.timestamp.hashAlgorithm ?? "sha256",
        timeoutMillis: valid.timestamp.timeoutMillis,
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
        catch: () =>
          new CmsError({
            code: CmsErrorCodeValue.encodeError,
            reason: "Failed to embed the timestamp token.",
            operation: CmsOperationValue.encode,
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
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.encodeError,
          reason: "Failed to serialize the CMS ContentInfo.",
          operation: CmsOperationValue.encode,
        }),
    });
  });
