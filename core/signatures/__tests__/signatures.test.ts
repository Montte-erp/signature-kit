import { describe, expect, it } from "@effect/vitest";
import {
  SignatureKitError,
  SignatureKitErrorCodeSchema,
  SignatureKitErrorCodeValue,
  signatureKitErrorCatalog,
} from "@signature-kit/signatures";

describe("SignatureKitError catalog", () => {
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
