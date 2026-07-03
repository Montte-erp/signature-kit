import { describe, expect, it } from "@effect/vitest";
import { type Asn1Node, decode, encode } from "@signature-kit/asn1";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { parsePkcs12 } from "../src/pkcs12";

const PASSWORD = Redacted.make("changeit");

/** Rebuild the fixture PFX with an absurd MacData iteration count. */
const withHugeMacIterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer);
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const macData = pfx.children[2];
    if (macData === undefined || macData.kind !== "constructed") {
      return yield* Effect.fail("no-mac-data");
    }
    const hugeIterations: Asn1Node = {
      kind: "primitive",
      class: "universal",
      tag: 0x02,
      bytes: Uint8Array.of(0x7f, 0xff, 0xff, 0xff), // 2^31 - 1
    };
    const patchedMac: Asn1Node = {
      ...macData,
      children: [...macData.children.slice(0, 2), hugeIterations],
    };
    const patchedPfx: Asn1Node = {
      ...pfx,
      children: pfx.children.map((child, index) => (index === 2 ? patchedMac : child)),
    };
    return encode(patchedPfx);
  });

describe("parsePkcs12 hardening", () => {
  it.effect("parses the untouched fixture", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const parsed = yield* parsePkcs12(pfxDer, PASSWORD);
      expect(parsed.certificate.byteLength).toBeGreaterThan(0);
      expect(parsed.privateKey.byteLength).toBeGreaterThan(0);
    }),
  );

  it.effect("rejects attacker-controlled MAC iteration counts instead of grinding the KDF", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withHugeMacIterations(pfxDer);

      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      const elapsedMs = performance.now() - started;

      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("iteration count");
      }
      // The whole point: fail fast, never run the 2^31-iteration KDF.
      expect(elapsedMs).toBeLessThan(1000);
    }),
  );
});
