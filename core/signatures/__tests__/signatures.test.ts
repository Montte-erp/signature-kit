import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  SignatureKitError,
  SignatureKitErrorCodeSchema,
  SignatureKitErrorCodeValue,
  signatureKitErrorCatalog,
} from "@signature-kit/signatures";

describe("SignatureKitError catalog", () => {
  it.effect("rejects unsupported operations through the typed error schema", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Schema.decodeUnknownEffect(SignatureKitError)({
          _tag: "SignatureKitError",
          code: SignatureKitErrorCodeValue.unknown,
          retryable: false,
          operation: "arbitrary",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
    }),
  );
  it("keeps exported catalog messages aligned with the tagged error", () => {
    for (const entry of signatureKitErrorCatalog) {
      const defaultError = new SignatureKitError({ code: entry.code, retryable: false });
      expect(defaultError.message).toBe(entry.message);

      const customReason = `custom reason for ${entry.code}`;
      const reasonError = new SignatureKitError({
        code: entry.code,
        retryable: false,
        reason: customReason,
      });
      expect(reasonError.message).toBe(entry.overridable ? customReason : entry.message);
    }
  });

  it("covers every declared error code exactly once", () => {
    const catalogCodes = signatureKitErrorCatalog.map((entry) => entry.code);

    expect(catalogCodes).toHaveLength(SignatureKitErrorCodeSchema.literals.length);
    for (const code of SignatureKitErrorCodeSchema.literals) {
      expect(catalogCodes.filter((candidate) => candidate === code)).toHaveLength(1);
    }
  });

  it("keeps transport and unsupported-operation codes reason-overridable", () => {
    const overridableCodes = signatureKitErrorCatalog
      .filter((entry) => entry.overridable)
      .map((entry) => entry.code);

    expect(overridableCodes).toContain(SignatureKitErrorCodeValue.http);
    expect(overridableCodes).toContain(SignatureKitErrorCodeValue.responseShape);
    expect(overridableCodes).toContain(SignatureKitErrorCodeValue.unsupportedOperation);
  });
});
