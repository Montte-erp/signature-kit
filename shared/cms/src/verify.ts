import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import {
  VerifyDetachedSignedDataInputSchema,
  CmsError,
  CmsErrorCodeValue,
  CmsOid,
  CmsOperationValue,
} from "./config";
import type { CmsVerifyResult, VerifyDetachedSignedDataInput } from "./config";
import { toArrayBuffer } from "./engine";

const isUint8Array = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === "[object Uint8Array]";

const SignedDataVerifyErrorSchema = Schema.Struct({
  name: Schema.Literals(["SignedDataVerifyError"]),
  code: Schema.Number,
  signatureVerified: Schema.optional(Schema.NullOr(Schema.Boolean)),
  signerCertificateVerified: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const BASIC_OCSP_RESPONSE_OID = "1.3.6.1.5.5.7.48.1.1";

const hasRecognizedRevocation = (signed: pkijs.SignedData): boolean =>
  signed.crls?.some(
    (entry) =>
      entry instanceof pkijs.CertificateRevocationList ||
      (entry instanceof pkijs.OtherRevocationInfoFormat &&
        entry.otherRevInfoFormat === BASIC_OCSP_RESPONSE_OID),
  ) === true || signed.ocsps?.some((entry) => entry instanceof pkijs.BasicOCSPResponse) === true;

const signerSerialHex = (signed: pkijs.SignedData): string | null => {
  const sid = signed.signerInfos[0]?.sid;
  if (sid === null || typeof sid !== "object") return null;
  const serial = "serialNumber" in sid ? sid.serialNumber : null;
  if (serial === null || typeof serial !== "object") return null;
  const valueBlock = "valueBlock" in serial ? serial.valueBlock : null;
  if (valueBlock === null || typeof valueBlock !== "object") return null;
  const view = "valueHexView" in valueBlock ? valueBlock.valueHexView : null;
  if (!isUint8Array(view)) return null;
  let output = "";
  for (const byte of view) output += byte.toString(16).padStart(2, "0");
  return output;
};

export const verifyDetachedSignedData = (
  input: VerifyDetachedSignedDataInput,
): Effect.Effect<CmsVerifyResult, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(VerifyDetachedSignedDataInputSchema)(
      input,
    ).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.verifyError,
            reason: `Invalid CMS verification input: ${String(issue)}`,
            operation: CmsOperationValue.verify,
          }),
      ),
    );

    const contentInfo = yield* Effect.try({
      try: () => pkijs.ContentInfo.fromBER(toArrayBuffer(valid.cms)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the CMS ContentInfo.",
          operation: CmsOperationValue.verify,
        }),
    });
    if (contentInfo.contentType !== CmsOid.signedData) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "CMS ContentInfo is not signedData.",
          operation: CmsOperationValue.verify,
        }),
      );
    }

    const signed = yield* Effect.try({
      try: () => new pkijs.SignedData({ schema: contentInfo.content }),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the CMS SignedData.",
          operation: CmsOperationValue.verify,
        }),
    });
    if (signed.encapContentInfo.eContentType !== CmsOid.data) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "CMS SignedData eContentType is not id-data.",
          operation: CmsOperationValue.verify,
        }),
      );
    }
    if (signed.encapContentInfo.eContent !== undefined) {
      return {
        valid: false,
        chainValid: false,
        revocationStatus: "not_checked",
        signerSerialNumber: signerSerialHex(signed),
      };
    }

    const trustedCerts = yield* Effect.try({
      try: () =>
        (valid.trustedRoots ?? []).map((der) => pkijs.Certificate.fromBER(toArrayBuffer(der))),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse a trusted root DER.",
          operation: CmsOperationValue.verify,
        }),
    });

    const serial = signerSerialHex(signed);
    const checkChain = trustedCerts.length > 0;

    const verification = yield* Effect.tryPromise({
      try: () =>
        signed.verify({
          signer: 0,
          data: toArrayBuffer(valid.content),
          checkChain,
          trustedCerts,
          passedWhenNotRevValues: false,
          extendedMode: true,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        Schema.decodeUnknownEffect(SignedDataVerifyErrorSchema)(cause).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.fail(
                new CmsError({
                  code: CmsErrorCodeValue.verifyError,
                  reason: "pkijs SignedData verification failed unexpectedly.",
                  operation: CmsOperationValue.verify,
                }),
              ),
            onSuccess: (error) =>
              Effect.succeed({
                signatureVerified: error.signatureVerified === true,
                signerCertificateVerified: error.signerCertificateVerified === true,
              }),
          }),
        ),
      ),
    );

    return {
      valid: verification.signatureVerified === true,
      chainValid: checkChain ? verification.signerCertificateVerified === true : false,
      revocationStatus: checkChain && hasRecognizedRevocation(signed) ? "checked" : "not_checked",
      signerSerialNumber: serial,
    };
  });
