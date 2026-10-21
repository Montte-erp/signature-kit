import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Result } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { inspectCertificateValidity } from "../src/index";

describe("certificate validity inspection", () => {
  it.effect("uses the Effect clock and includes both validity boundaries", () =>
    Effect.gen(function* () {
      const validity = { notBefore: new Date(1000), notAfter: new Date(86401000) };
      yield* TestClock.setTime(0);
      const future = yield* inspectCertificateValidity(validity);
      expect(future.status).toBe("notYetValid");
      expect(future.evaluatedAt.getTime()).toBe(0);
      expect(future.daysUntilExpiry).toBe(1);
      yield* TestClock.setTime(1000);
      const active = yield* inspectCertificateValidity(validity);
      expect(active.status).toBe("valid");
      expect(active.remainingMillis).toBe(86400000);
      yield* TestClock.setTime(86401000);
      const boundary = yield* inspectCertificateValidity(validity);
      expect(boundary.status).toBe("valid");
      expect(boundary.remainingMillis).toBe(0);
      yield* TestClock.adjust(Duration.millis(1));
      const expired = yield* inspectCertificateValidity(validity);
      expect(expired.status).toBe("expired");
      expect(expired.remainingMillis).toBe(-1);
      expect(expired.daysUntilExpiry).toBe(-1);
    }),
  );

  it.effect("rejects invalid dates and reversed validity intervals", () =>
    Effect.gen(function* () {
      for (const validity of [
        { notBefore: new Date("invalid"), notAfter: new Date(1000) },
        { notBefore: new Date(1000), notAfter: new Date("invalid") },
        { notBefore: new Date(2000), notAfter: new Date(1000) },
      ]) {
        const result = yield* Effect.result(inspectCertificateValidity(validity));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("signature-kit.INVALID_INPUT");
          expect(result.failure.schemaName).toBe("CertificateValidity");
        }
      }
    }),
  );
});
