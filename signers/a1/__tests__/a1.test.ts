import { describe, expect, it } from "@effect/vitest";
import { createSignatureKit, signatures } from "@signature-kit/core";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer, loadA1SignerAdapter } from "@signature-kit/a1";

const PASSWORD = Redacted.make("changeit");
const textEncoder = new TextEncoder();

describe("A1 signatures", () => {
  it.effect("loads an e-CPF A1 certificate and signs through the agnostic service", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const content = textEncoder.encode("signature-kit e-cpf payload");

      const result = yield* Effect.gen(function* () {
        const identity = yield* signatures.inspect();
        const artifact = yield* signatures.sign({ content, algorithm: "rsa-sha256" });
        const verification = yield* signatures.verify({
          content,
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });
        const tampered = yield* signatures.verify({
          content: textEncoder.encode("tampered"),
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });

        return { artifact, identity, tampered, verification };
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));

      expect(result.identity.document).toBe("12345678901");
      expect(result.artifact.algorithm).toBe("rsa-sha256");
      expect(result.artifact.signature.byteLength).toBeGreaterThan(0);
      expect(result.verification.valid).toBe(true);
      expect(result.tampered.valid).toBe(false);
    }),
  );

  it.effect("loads an e-CNPJ A1 certificate and signs SHA-512", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const content = textEncoder.encode("signature-kit e-cnpj payload");

      const result = yield* Effect.gen(function* () {
        const identity = yield* signatures.inspect();
        const artifact = yield* signatures.sign({ content, algorithm: "rsa-sha512" });
        const verification = yield* signatures.verify({
          content,
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });

        return { artifact, identity, verification };
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));

      expect(result.identity.document).toBe("12345678000195");
      expect(result.artifact.algorithm).toBe("rsa-sha512");
      expect(result.verification.valid).toBe(true);
    }),
  );

  it.effect("creates a PayKit-style SignatureKit runtime from an A1 signer", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signer = yield* loadA1SignerAdapter({ pfx, password: PASSWORD });
      const signatureKit = createSignatureKit({ signer });
      const content = textEncoder.encode("signature-kit runtime payload");

      const identity = yield* signatureKit.certificates.inspect();
      const certificate = yield* signatureKit.certificates.get();
      const artifact = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha256" });
      const verification = yield* signatureKit.signatures.verify({
        content,
        signature: artifact.signature,
        algorithm: artifact.algorithm,
      });

      expect(identity.document).toBe("12345678901");
      expect(certificate.serialNumber).not.toBe("");
      expect(verification.valid).toBe(true);
    }),
  );

  it.effect("caches imported WebCrypto keys per adapter", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const result = yield* Effect.gen(function* () {
        const adapter = yield* loadA1SignerAdapter({ pfx, password: PASSWORD });
        const first = yield* adapter.importSigningKey("rsa-sha256");
        const second = yield* adapter.importSigningKey("rsa-sha256");
        const sha512 = yield* adapter.importSigningKey("rsa-sha512");
        return { first, second, sha512 };
      });

      expect(result.first).toBe(result.second);
      expect(result.first).not.toBe(result.sha512);
    }),
  );
});
