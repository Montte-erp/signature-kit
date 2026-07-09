import { Result, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { errorMessage } from "@signature-kit/i18n";
import { ErrorMessageOptionsSchema } from "../src/i18n";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  signatureKitErrorMessages,
} from "@signature-kit/signatures";
import { cryptoErrorMessages } from "@signature-kit/crypto/config";

describe("errorMessage", () => {
  it("resolves known SignatureKit codes in pt-BR", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.wrongPassword,
      retryable: false,
      reason: "technical diagnostic text that UI must not parse",
    });

    expect(
      errorMessage(error, {
        locale: "pt-BR",
        catalogs: [signatureKitErrorMessages],
      }),
    ).toBe("Senha do certificado incorreta.");
  });

  it("falls back to en-US when the requested locale is missing", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.missingBrIdentifier,
      retryable: false,
    });

    expect(
      errorMessage(error, {
        locale: "es-ES",
        catalogs: [signatureKitErrorMessages],
      }),
    ).toBe("Certificate does not contain a Brazilian CPF or CNPJ.");
  });

  it("lets overrides win before package catalogs", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.wrongPassword,
      retryable: false,
    });

    expect(
      errorMessage(error, {
        locale: "pt-BR",
        catalogs: [signatureKitErrorMessages],
        overrides: {
          "pt-BR": {
            "signature-kit.WRONG_PASSWORD": "Senha inválida para este certificado",
          },
        },
      }),
    ).toBe("Senha inválida para este certificado");
  });

  it("does not read inherited catalog members for code keys", () => {
    const error = {
      _tag: "SignatureKitError",
      code: "toString",
    };

    const catalogMessages = Object.create({ toString: "prototype message" });

    expect(
      errorMessage(error, {
        locale: "en-US",
        catalogs: [
          {
            "en-US": catalogMessages,
          },
        ],
      }),
    ).toBe("Something went wrong.");
  });

  it("does not read inherited catalog members when locale key is '__proto__'", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.wrongPassword,
      retryable: false,
    });

    const localeMessages = Object.create({
      "signature-kit.WRONG_PASSWORD": "prototype locale message",
    });

    const catalogs = Object.create(localeMessages);

    expect(
      errorMessage(error, {
        locale: "__proto__",
        catalogs: [catalogs],
      }),
    ).toBe("Something went wrong.");
  });

  it("rejects a malformed fallback locale at the schema boundary before lookup", () => {
    const malformedOptions = JSON.parse(
      JSON.stringify({
        locale: "pt-BR",
        catalogs: [signatureKitErrorMessages],
        fallbackLocale: "es-ES",
      }),
    );

    const result = Schema.decodeUnknownResult(ErrorMessageOptionsSchema)(malformedOptions);

    expect(Result.isFailure(result)).toBe(true);
  });

  it("prefers an explicit empty-string override", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.wrongPassword,
      retryable: false,
    });

    expect(
      errorMessage(error, {
        locale: "pt-BR",
        catalogs: [signatureKitErrorMessages],
        overrides: {
          "pt-BR": {
            [SignatureKitErrorCodeValue.wrongPassword]: "",
          },
        },
      }),
    ).toBe("");
  });

  it("uses requested-locale catalog entries before fallback-locale overrides", () => {
    const error = new SignatureKitError({
      code: SignatureKitErrorCodeValue.wrongPassword,
      retryable: false,
    });

    expect(
      errorMessage(error, {
        locale: "pt-BR",
        fallbackLocale: "en-US",
        catalogs: [
          {
            "pt-BR": {
              [SignatureKitErrorCodeValue.wrongPassword]: "requested locale catalog message",
            },
            "en-US": {
              [SignatureKitErrorCodeValue.wrongPassword]: "fallback locale catalog message",
            },
          },
        ],
        overrides: {
          "en-US": {
            [SignatureKitErrorCodeValue.wrongPassword]: "fallback locale override message",
          },
        },
      }),
    ).toBe("requested locale catalog message");
  });

  it("returns localized generic fallback for unknown shapes", () => {
    expect(
      errorMessage(
        { message: "plain thrown value" },
        {
          locale: "pt-BR",
          catalogs: [signatureKitErrorMessages],
        },
      ),
    ).toBe("Algo deu errado.");
  });

  it("returns localized generic fallback for unknown codes", () => {
    expect(
      errorMessage(
        { _tag: "SignatureKitError", code: "signature-kit.NOT_A_REAL_CODE" },
        {
          locale: "pt-BR",
          catalogs: [signatureKitErrorMessages],
        },
      ),
    ).toBe("Algo deu errado.");
  });

  it("resolves catalogs from other packages without coupling the i18n package to them", () => {
    const cryptoWrongPassword = {
      _tag: "CryptoError",
      code: "crypto.WRONG_PASSWORD",
    };

    expect(
      errorMessage(cryptoWrongPassword, {
        locale: "pt-BR",
        catalogs: [signatureKitErrorMessages, cryptoErrorMessages],
      }),
    ).toBe("Senha do certificado incorreta.");
  });
});
