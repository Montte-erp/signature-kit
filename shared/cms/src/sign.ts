import * as asn1js from "asn1js";
import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import { buildSignedAttributes } from "./attributes.js";
import {
  CreateDetachedSignedDataInputSchema,
  CmsError,
  CmsErrorCodeValue,
  CmsOid,
  CmsOperationValue,
  webCryptoHashName,
} from "./config.js";
import type { CreateDetachedSignedDataInput } from "./config.js";
import { digest, toArrayBuffer, toBufferSource } from "./engine.js";
import { requestTimestamp } from "./timestamp.js";

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

    const certificate = yield* Effect.try({
      try: () => pkijs.Certificate.fromBER(toArrayBuffer(valid.certificateDer)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the signer certificate DER.",
          operation: CmsOperationValue.parse,
        }),
    });

    const embeddedCertificateDer = yield* Effect.try({
      try: () => new Uint8Array(certificate.toSchema().toBER(false)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.encodeError,
          reason: "Failed to serialize the signer certificate for CMS embedding.",
          operation: CmsOperationValue.encode,
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

    const [messageDigest, certificateSha256] = yield* Effect.all(
      [digest(hashAlgorithm, valid.content), digest("sha256", embeddedCertificateDer)],
      { concurrency: "unbounded" },
    );

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
        trustedRoots: valid.timestamp.trustedRoots,
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
