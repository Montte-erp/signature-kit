import { describe, expect, it } from "@effect/vitest";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import {
  a1SignaturesLayer,
  a1SignaturesLayerFromUrl,
  fetchA1Pkcs12,
  loadA1SignerAdapter,
  parseA1CertificateProfileFromUrl,
} from "@signature-kit/a1/signer";
import { SignatureKitErrorCodeValue } from "@signature-kit/core/config";

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

  it.effect("loads an e-CPF A1 certificate and signs legacy RSA-SHA1", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const content = textEncoder.encode("signature-kit legacy sha1 payload");

      const result = yield* Effect.gen(function* () {
        const artifact = yield* signatures.sign({ content, algorithm: "rsa-sha1" });
        const verification = yield* signatures.verify({
          content,
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });

        return { artifact, verification };
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));

      expect(result.artifact.algorithm).toBe("rsa-sha1");
      expect(result.artifact.signature.byteLength).toBeGreaterThan(0);
      expect(result.verification.valid).toBe(true);
    }),
  );

  it.effect("keeps wrong PKCS#12 passwords in the typed error channel", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const result = yield* Effect.result(
        loadA1SignerAdapter({ pfx, password: Redacted.make("wrong-password") }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.WRONG_PASSWORD");
      }
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

  it.effect("signs empty, large, and repeated A1 payloads", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const largePayload = new Uint8Array(1024 * 1024);
      largePayload.fill(0x5a);
      const payloads = [
        new Uint8Array(),
        largePayload,
        ...Array.from({ length: 32 }, (_, index) =>
          textEncoder.encode(`RFC 8017 repeated payload ${index}`),
        ),
      ];

      const result = yield* Effect.gen(function* () {
        const adapter = yield* loadA1SignerAdapter({ pfx, password: PASSWORD });
        return yield* Effect.forEach(
          payloads,
          (content) =>
            adapter.sign({ content, algorithm: "rsa-sha256" }).pipe(
              Effect.flatMap((artifact) =>
                adapter
                  .verify({
                    content,
                    signature: artifact.signature,
                    algorithm: artifact.algorithm,
                  })
                  .pipe(Effect.map((verification) => ({ artifact, verification }))),
              ),
            ),
          { concurrency: 1 },
        );
      });

      expect(result.every(({ artifact }) => artifact.signature.byteLength > 0)).toBe(true);
      expect(result.every(({ verification }) => verification.valid)).toBe(true);
    }),
  );

  it.effect("exposes an A1 signer through the Signatures service", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const content = textEncoder.encode("signature-kit runtime payload");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });

      const result = yield* Effect.gen(function* () {
        const identity = yield* signatures.inspect();
        const certificate = yield* signatures.certificate();
        const artifact = yield* signatures.sign({ content, algorithm: "rsa-sha256" });
        const verification = yield* signatures.verify({
          content,
          signature: artifact.signature,
          algorithm: artifact.algorithm,
        });
        return { identity, certificate, verification };
      }).pipe(Effect.provide(layer));

      expect(result.identity.document).toBe("12345678901");
      expect(result.certificate.serialNumber).not.toBe("");
      expect(result.verification.valid).toBe(true);
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

  it.effect("loads an A1 certificate from a (presigned) URL and signs through the service", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      // A data: URL stands in for a presigned URL so the test stays offline; the
      // fetch path is identical (GET -> arrayBuffer).
      const url = `data:application/x-pkcs12;base64,${Buffer.from(pfx).toString("base64")}`;

      const fetched = yield* fetchA1Pkcs12({ url });
      expect(fetched.byteLength).toBe(pfx.byteLength);

      const profile = yield* parseA1CertificateProfileFromUrl({ url, password: PASSWORD });
      expect(profile.document.length).toBeGreaterThan(0);

      const content = textEncoder.encode("signature-kit remote A1 payload");
      const artifact = yield* signatures
        .sign({ content, algorithm: "rsa-sha256" })
        .pipe(Effect.provide(a1SignaturesLayerFromUrl({ url, password: PASSWORD })));
      expect(artifact.signature.byteLength).toBeGreaterThan(0);
    }),
  );

  it.effect("fails with EMPTY_FILE when the remote A1 has no body", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        fetchA1Pkcs12({ url: "data:application/x-pkcs12;base64," }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.emptyFile);
      }
    }),
  );
});
