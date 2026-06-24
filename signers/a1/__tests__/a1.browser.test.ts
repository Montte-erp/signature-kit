import { describe, expect, it } from "@effect/vitest";
import { loadA1SignatureKit, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import { Effect, Redacted } from "effect";

const PASSWORD = Redacted.make("changeit");
const textEncoder = new TextEncoder();

const readA1FixtureFromBrowser = (name: "ecpf" | "ecnpj"): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const fixtureUrl = new URL(`./fixtures/${name}.p12`, import.meta.url);
    const response = await fetch(fixtureUrl);
    expect(response.ok).toBe(true);
    return new Uint8Array(await response.arrayBuffer());
  });

if (typeof document === "undefined") {
  describe.skip("A1 browser integration", () => {
    it("runs only through `bun run test:integration:browser`", () => {});
  });
} else {
  describe("A1 browser integration", () => {
    it.effect("loads e-CPF and e-CNPJ A1 certificates and signs with browser WebCrypto", () =>
      Effect.gen(function* () {
        expect(typeof window.crypto.subtle.importKey).toBe("function");
        expect(typeof document.createElement).toBe("function");

        const ecpf = yield* readA1FixtureFromBrowser("ecpf");
        const ecnpj = yield* readA1FixtureFromBrowser("ecnpj");
        const ecpfProfile = yield* parseA1CertificateProfile({ pfx: ecpf, password: PASSWORD });
        const ecnpjProfile = yield* parseA1CertificateProfile({ pfx: ecnpj, password: PASSWORD });
        expect(ecpfProfile.document).toBe("12345678901");
        expect(ecnpjProfile.document).toBe("12345678000195");
        expect(ecpfProfile.daysUntilExpiry).toBeGreaterThan(0);
        expect(ecnpjProfile.daysUntilExpiry).toBeGreaterThan(0);

        const signatureKit = yield* loadA1SignatureKit({ pfx: ecpf, password: PASSWORD });
        const content = textEncoder.encode("SignatureKit A1 browser payload");
        const sha1 = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha1" });
        const sha256 = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha256" });
        const sha512 = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha512" });
        const sha1Verification = yield* signatureKit.signatures.verify({
          content,
          signature: sha1.signature,
          algorithm: sha1.algorithm,
        });
        const sha256Verification = yield* signatureKit.signatures.verify({
          content,
          signature: sha256.signature,
          algorithm: sha256.algorithm,
        });
        const sha512Verification = yield* signatureKit.signatures.verify({
          content,
          signature: sha512.signature,
          algorithm: sha512.algorithm,
        });
        const tampered = yield* signatureKit.signatures.verify({
          content: textEncoder.encode("tampered"),
          signature: sha512.signature,
          algorithm: sha512.algorithm,
        });

        expect(sha1.signature.byteLength).toBeGreaterThan(0);
        expect(sha256.signature.byteLength).toBeGreaterThan(0);
        expect(sha512.signature.byteLength).toBeGreaterThan(0);
        expect(sha1Verification.valid).toBe(true);
        expect(sha256Verification.valid).toBe(true);
        expect(sha512Verification.valid).toBe(true);
        expect(tampered.valid).toBe(false);
      }),
    );
  });
}
