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
    it.effect("loads an A1 signer and signs with browser WebCrypto", () =>
      Effect.gen(function* () {
        expect(typeof window.crypto.subtle.importKey).toBe("function");
        expect(typeof document.createElement).toBe("function");

        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const profile = yield* parseA1CertificateProfile({ pfx, password: PASSWORD });
        expect(profile.document).toBe("12345678901");
        expect(profile.daysUntilExpiry).toBeGreaterThan(0);

        const signatureKit = yield* loadA1SignatureKit({ pfx, password: PASSWORD });
        const content = textEncoder.encode("SignatureKit A1 browser payload");
        const artifact = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha256" });
        const verification = yield* signatureKit.signatures.verify({
          content,
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });
        const tampered = yield* signatureKit.signatures.verify({
          content: textEncoder.encode("tampered"),
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });

        expect(artifact.signature.byteLength).toBeGreaterThan(0);
        expect(verification.valid).toBe(true);
        expect(tampered.valid).toBe(false);
      }),
    );
  });
}
