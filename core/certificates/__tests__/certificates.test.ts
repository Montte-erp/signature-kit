import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { daysUntilExpiry, isCertificateValid, parseCertificate } from "@signature-kit/certificates";
import { Effect, Redacted, Result } from "effect";

const testPassword = Redacted.make("test1234");
const lacunaPassword = Redacted.make("1234");

const readFixture = (name: string): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))),
  );

const binaryString = (bytes: Uint8Array): string => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
};

describe("certificates", () => {
  it.effect("parses a valid PKCS#12 file and exposes certificate material", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const cert = yield* parseCertificate(pfx, testPassword);

      expect(cert.serialNumber).not.toBe("");
      expect(cert.certPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(Redacted.value(cert.privateKeyPem)).toContain("-----BEGIN PRIVATE KEY-----");
      expect(cert.certificateDer.byteLength).toBeGreaterThan(0);
      expect(cert.publicKeyDer.byteLength).toBeGreaterThan(0);
      expect(Object.hasOwn(cert, "pfxBuffer")).toBe(false);
      expect(Object.hasOwn(cert, "pfxPassword")).toBe(false);
    }),
  );

  it.effect("normalizes ArrayBufferView and binary string certificate inputs", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const padded = new Uint8Array(pfx.length + 4);
      padded.set([0xff, 0xff], 0);
      padded.set(pfx, 2);
      const view = new DataView(padded.buffer, 2, pfx.length);

      const fromBytes = yield* parseCertificate(pfx, testPassword);
      const fromView = yield* parseCertificate(view, testPassword);
      const fromBinary = yield* parseCertificate(binaryString(pfx), testPassword);

      expect(fromView.serialNumber).toBe(fromBytes.serialNumber);
      expect(fromBinary.serialNumber).toBe(fromBytes.serialNumber);
    }),
  );

  it.effect("extracts subject issuer validity fingerprint and Brazilian identity", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const cert = yield* parseCertificate(pfx, testPassword);

      expect(cert.subject.commonName).toBe("Test Company LTDA");
      expect(cert.subject.organization).toBe("Test Org");
      expect(cert.subject.country).toBe("BR");
      expect(cert.subject.raw.length).toBeGreaterThan(0);
      expect(cert.issuer.commonName).toBe("Test Company LTDA");
      expect(cert.issuer.organization).toBe("Test Org");
      expect(cert.validity.notAfter.getTime()).toBeGreaterThan(cert.validity.notBefore.getTime());
      expect(cert.fingerprint).toHaveLength(64);
      expect(cert.isValid).toBe(true);
      expect(isCertificateValid(cert)).toBe(true);
      expect(daysUntilExpiry(cert)).toBeGreaterThan(0);
      expect(cert.brazilian.cnpj).toBe("12345678000190");
    }),
  );

  it.effect("extracts CPF and CNPJ from ICP-Brasil subjectAltName otherName", () =>
    Effect.gen(function* () {
      const turing = yield* readFixture("lacuna-turing.pfx");
      const wayne = yield* readFixture("lacuna-wayne.pfx");

      const cpfCert = yield* parseCertificate(turing, lacunaPassword);
      const cnpjCert = yield* parseCertificate(wayne, lacunaPassword);

      expect(cpfCert.brazilian.cpf).toBe("56072386105");
      expect(cpfCert.subjectAltName).toContain("CPF=56072386105");
      expect(cnpjCert.brazilian.cnpj).toBe("34785515000166");
      expect(cnpjCert.subjectAltName).toContain("CNPJ=34785515000166");
    }),
  );

  it.effect("keeps parse failures in the typed Effect error channel", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const wrongPassword = yield* Effect.result(
        parseCertificate(pfx, Redacted.make("wrongpassword")),
      );
      const invalidText = yield* Effect.result(
        parseCertificate(new TextEncoder().encode("not a pfx"), testPassword),
      );
      const empty = yield* Effect.result(parseCertificate(new Uint8Array(0), testPassword));
      const fakePdf = yield* Effect.result(
        parseCertificate(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]), testPassword),
      );
      const fakePng = yield* Effect.result(
        parseCertificate(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), testPassword),
      );

      expect(Result.isFailure(wrongPassword)).toBe(true);
      if (Result.isFailure(wrongPassword)) {
        expect(wrongPassword.failure.code).toBe("signature-kit.WRONG_PASSWORD");
        expect(wrongPassword.failure.reason).toBeDefined();
      }
      expect(Result.isFailure(invalidText)).toBe(true);
      if (Result.isFailure(invalidText)) {
        expect(invalidText.failure.code).toBe("signature-kit.INVALID_FORMAT");
      }
      expect(Result.isFailure(empty)).toBe(true);
      if (Result.isFailure(empty)) {
        expect(empty.failure.code).toBe("signature-kit.EMPTY_FILE");
      }
      expect(Result.isFailure(fakePdf)).toBe(true);
      if (Result.isFailure(fakePdf)) {
        expect(fakePdf.failure.code).toBe("signature-kit.INVALID_FORMAT");
        expect(fakePdf.failure.message).toContain("PDF");
      }
      expect(Result.isFailure(fakePng)).toBe(true);
      if (Result.isFailure(fakePng)) {
        expect(fakePng.failure.code).toBe("signature-kit.INVALID_FORMAT");
        expect(fakePng.failure.message).toContain("PNG");
      }
    }),
  );

  it.effect("parses the Lacuna ICP-Brasil fixture sweep", () =>
    Effect.gen(function* () {
      const turing = yield* parseCertificate(
        yield* readFixture("lacuna-turing.pfx"),
        lacunaPassword,
      );
      const frobenius = yield* parseCertificate(
        yield* readFixture("lacuna-frobenius.pfx"),
        lacunaPassword,
      );
      const fermat = yield* parseCertificate(
        yield* readFixture("lacuna-fermat.pfx"),
        lacunaPassword,
      );
      const wayne = yield* parseCertificate(yield* readFixture("lacuna-wayne.pfx"), lacunaPassword);

      expect(turing.brazilian.cpf).toBe("56072386105");
      expect(frobenius.brazilian.cpf).toBe("87378011126");
      expect(fermat.brazilian.cpf).toBe("47363361886");
      expect(wayne.brazilian.cnpj).toBe("34785515000166");
    }),
  );
});
