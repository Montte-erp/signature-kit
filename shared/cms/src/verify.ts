/**
 * verifyDetachedSignedData — verify a detached CMS SignedData against its content.
 *
 * pkijs `verify()` THROWS `SignedDataVerifyError` on a digest/signature mismatch
 * instead of returning false; we narrow that at the boundary and turn it into a
 * `valid: false` verdict. Malformed input and engine faults stay tagged errors.
 * When `trustedRoots` is supplied, the signer chain is validated too.
 */

import { Effect, Option, Schema } from "effect";
import * as pkijs from "pkijs";
import {
  type CmsVerifyResult,
  type VerifyDetachedSignedDataInput,
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
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const verifyDetachedSignedData = (
  input: VerifyDetachedSignedDataInput,
): Effect.Effect<CmsVerifyResult, CmsError> =>
  Effect.gen(function* () {
    const signed = yield* Effect.try({
      try: () => {
        const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(input.cms));
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
        (input.trustedRoots ?? []).map((der) => pkijs.Certificate.fromBER(toArrayBuffer(der))),
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
          data: toArrayBuffer(input.content),
          checkChain,
          trustedCerts,
          extendedMode: true,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          Option.isSome(Schema.decodeUnknownOption(SignedDataVerifyErrorSchema)(cause))
            ? Effect.succeed(undefined)
            : Effect.die(cause),
        onSuccess: (result) => Effect.succeed(result),
      }),
    );

    if (verification === undefined) {
      return {
        valid: false,
        chainValid: false,
        signerSerialNumber: serial,
      };
    }

    return {
      valid: verification.signatureVerified === true,
      chainValid: checkChain ? verification.signerCertificateVerified === true : true,
      signerSerialNumber: serial,
    };
  });
