import { describe, expect, it } from "@effect/vitest";
import { loadA1SignerAdapter, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";

const PASSWORD = Redacted.make("changeit");
const textEncoder = new TextEncoder();

const millisecondsSince = (startedAt: number): number => performance.now() - startedAt;

describe("A1 signer performance", () => {
  it.effect("keeps certificate profile parsing within an app-request budget", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const startedAt = performance.now();

      const profiles = yield* Effect.all(
        Array.from({ length: 5 }, () => parseA1CertificateProfile({ pfx, password: PASSWORD })),
        { concurrency: 1 },
      );
      const elapsedMillis = millisecondsSince(startedAt);

      expect(profiles.every((profile) => profile.document === "12345678901")).toBe(true);
      expect(elapsedMillis).toBeLessThan(2_500);
    }),
  );

  it.effect("reuses imported signing keys for repeated app-side signatures", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signer = yield* loadA1SignerAdapter({ pfx, password: PASSWORD });
      const payloads = Array.from({ length: 25 }, (_, index) =>
        textEncoder.encode(`SignatureKit performance payload ${index}`),
      );

      const startedAt = performance.now();
      const artifacts = yield* Effect.all(
        payloads.map((content) =>
          signer.sign({ content, algorithm: "rsa-sha256" }).pipe(
            Effect.flatMap((artifact) =>
              signer
                .verify({
                  content,
                  signature: artifact.signature,
                  algorithm: artifact.algorithm,
                })
                .pipe(Effect.map((verification) => ({ artifact, verification }))),
            ),
          ),
        ),
        { concurrency: 1 },
      );
      const elapsedMillis = millisecondsSince(startedAt);

      expect(artifacts.every(({ artifact }) => artifact.signature.byteLength > 0)).toBe(true);
      expect(artifacts.every(({ verification }) => verification.valid)).toBe(true);
      expect(elapsedMillis).toBeLessThan(1_500);
    }),
  );

  it.effect("imports one CryptoKey per algorithm per adapter", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const adapter = yield* loadA1SignerAdapter({ pfx, password: PASSWORD });
      const firstSha256 = yield* adapter.importSigningKey("rsa-sha256");
      const secondSha256 = yield* adapter.importSigningKey("rsa-sha256");
      const sha512 = yield* adapter.importSigningKey("rsa-sha512");

      expect(firstSha256).toBe(secondSha256);
      expect(firstSha256).not.toBe(sha512);
    }),
  );
});
