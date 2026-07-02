/**
 * verifyDetachedSignedData — verify a detached CMS SignedData against its content.
 *
 * pkijs `verify()` THROWS `SignedDataVerifyError` on a digest/signature mismatch
 * instead of returning false; we narrow that at the boundary and turn it into a
 * `valid: false` verdict. Malformed input and engine faults stay tagged errors.
 * When `trustedRoots` is supplied, the signer chain is validated too.
 */

import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import {
  type CmsVerifyResult,
  type VerifyDetachedSignedDataInput,
  VerifyDetachedSignedDataInputSchema,
  CmsError,
  CmsErrorCodeValue,
  CmsOperationValue,
} from "./config";
import { toArrayBuffer } from "./engine";

const isUint8Array = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === "[object Uint8Array]";

const SignedDataVerifyErrorSchema = Schema.Struct({
  name: Schema.Literals(["SignedDataVerifyError"]),
  code: Schema.Number,
});

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

    const signed = yield* Effect.try({
      try: () => {
        const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(valid.cms));
        return new pkijs.SignedData({ schema: contentInfo.content });
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the CMS ContentInfo.",
          operation: CmsOperationValue.verify,
        }),
    });

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
    const hasEmbeddedRevocation = (signed.crls?.length ?? 0) > 0 || (signed.ocsps?.length ?? 0) > 0;

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
            onSuccess: () =>
              Effect.succeed({
                signatureVerified: false,
                signerCertificateVerified: false,
              }),
          }),
        ),
      ),
    );

    return {
      valid: verification.signatureVerified === true,
      chainValid: checkChain ? verification.signerCertificateVerified === true : false,
      revocationStatus: checkChain && hasEmbeddedRevocation ? "checked" : "not_checked",
      signerSerialNumber: serial,
    };
  });
