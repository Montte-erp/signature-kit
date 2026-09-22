import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { vi } from "vitest";
import { MAX_NATIVE_TIMEOUT_MILLIS } from "../src/config";
import {
  IcpBrasilPadesPolicy,
  fetchIcpBrasilPadesPolicy,
  parseIcpBrasilPadesPolicy,
} from "../src/icp-brasil";

const invalidTimeoutMillis: ReadonlyArray<number> = [
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  -1,
  0.5,
  2 ** 31,
];

const readPolicyFixture = (): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () =>
      new Uint8Array(
        await readFile(new URL("./fixtures/PA_PAdES_AD_RB_v1_1.der", import.meta.url)),
      ),
  );

describe("ICP-Brasil PAdES policy", () => {
  it.effect("parses the pinned ICP-Brasil AD-RB policy fixture", () =>
    Effect.gen(function* () {
      const fixture = yield* readPolicyFixture();
      const policy = yield* parseIcpBrasilPadesPolicy(fixture);

      expect(policy.policyOid).toBe(IcpBrasilPadesPolicy.adRbV11.policyOid);
      expect(policy.policyUri).toBe(IcpBrasilPadesPolicy.adRbV11.policyUri);
      expect(policy.policyHashAlgorithm).toBe(IcpBrasilPadesPolicy.adRbV11.policyHashAlgorithm);
      expect(policy.policyHash).toEqual(IcpBrasilPadesPolicy.adRbV11.policyHash);
    }),
  );

  it.effect("rejects ICP-Brasil policies with invalid universal tags", () =>
    Effect.gen(function* () {
      const valid = Uint8Array.of(
        0x30,
        0x14,
        0x30,
        0x0b,
        0x06,
        0x09,
        0x60,
        0x86,
        0x48,
        0x01,
        0x65,
        0x03,
        0x04,
        0x02,
        0x01,
        0x30,
        0x02,
        0x05,
        0x00,
        0x04,
        0x01,
        0x00,
      );
      const malformed: ReadonlyArray<{ readonly offset: number; readonly value: number }> = [
        { offset: 0, value: 0x31 },
        { offset: 0, value: 0xb0 },
        { offset: 2, value: 0x31 },
        { offset: 4, value: 0x04 },
        { offset: 19, value: 0x03 },
      ];

      for (const { offset, value } of malformed) {
        const mutated = Uint8Array.from(valid);
        mutated[offset] = value;
        const result = yield* Effect.result(parseIcpBrasilPadesPolicy(mutated));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.POLICY_ERROR");
      }
    }),
  );

  it.effect("accepts a downloaded policy only when its encoded hash matches the pin", () =>
    Effect.gen(function* () {
      const fixture = yield* readPolicyFixture();
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(new Uint8Array(fixture).buffer, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      );

      const policy = yield* fetchIcpBrasilPadesPolicy({ timeoutMillis: 1000 });

      expect(policy.policyHash).toEqual(IcpBrasilPadesPolicy.adRbV11.policyHash);
      expect(policy.policyHashAlgorithm).toBe(IcpBrasilPadesPolicy.adRbV11.policyHashAlgorithm);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("uses the default timeout when policy fetch options are omitted", () =>
    Effect.gen(function* () {
      const fixture = yield* readPolicyFixture();
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(new Uint8Array(fixture).buffer, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      );

      const policy = yield* fetchIcpBrasilPadesPolicy();

      expect(policy.policyHash).toEqual(IcpBrasilPadesPolicy.adRbV11.policyHash);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects invalid policy timeouts before scheduling or fetching", () =>
    Effect.gen(function* () {
      const fetch = vi.fn();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      vi.stubGlobal("fetch", fetch);

      for (const timeoutMillis of invalidTimeoutMillis) {
        const result = yield* Effect.result(fetchIcpBrasilPadesPolicy({ timeoutMillis }));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.POLICY_ERROR");
      }

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("clears policy timers when fetch throws synchronously", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const removeEventListenerSpy = vi.spyOn(AbortSignal.prototype, "removeEventListener");
      vi.stubGlobal("fetch", () => {
        throw new Error("synchronous fetch failure");
      });

      const result = yield* Effect.result(fetchIcpBrasilPadesPolicy({ timeoutMillis: 1000 }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.POLICY_ERROR");
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(removeEventListenerSpy.mock.calls.some(([event]) => event === "abort")).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.useRealTimers();
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("accepts the maximum native policy timeout", () =>
    Effect.gen(function* () {
      const fixture = yield* readPolicyFixture();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(new Uint8Array(fixture).buffer, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
      );

      const policy = yield* fetchIcpBrasilPadesPolicy({
        timeoutMillis: MAX_NATIVE_TIMEOUT_MILLIS,
      });

      expect(policy.policyHash).toEqual(IcpBrasilPadesPolicy.adRbV11.policyHash);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), MAX_NATIVE_TIMEOUT_MILLIS);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("rejects a downloaded policy whose encoded hash was mutated", () =>
    Effect.gen(function* () {
      const fixture = yield* readPolicyFixture();
      const mutated = Uint8Array.from(fixture);
      const lastByte = mutated.byteLength - 1;
      mutated[lastByte] = (mutated[lastByte] ?? 0) ^ 0x01;
      vi.stubGlobal("fetch", () =>
        Promise.resolve(new Response(new Uint8Array(mutated).buffer, { status: 200 })),
      );

      const result = yield* Effect.result(fetchIcpBrasilPadesPolicy({ timeoutMillis: 1000 }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.POLICY_ERROR");
        expect(result.failure.reason).toContain("pinned policy hash");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("aborts an endless non-success policy response body before reporting HTTP status", () =>
    Effect.gen(function* () {
      let aborted = false;
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                const abort = () => {
                  aborted = true;
                  controller.error(new Error("aborted"));
                };
                if (signal === null || signal === undefined) return;
                if (signal.aborted) {
                  abort();
                  return;
                }
                signal.addEventListener("abort", abort, { once: true });
              },
            }),
            { status: 503 },
          ),
        );
      });

      const result = yield* Effect.result(fetchIcpBrasilPadesPolicy({ timeoutMillis: 1000 }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toContain("HTTP 503");
      expect(aborted).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("times out a hanging policy body and aborts its fetch lifecycle", () =>
    Effect.gen(function* () {
      let aborted = false;
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                const abort = () => {
                  aborted = true;
                  controller.error(new Error("aborted"));
                };
                if (signal === null || signal === undefined) return;
                if (signal.aborted) {
                  abort();
                  return;
                }
                signal.addEventListener("abort", abort, { once: true });
              },
            }),
            { status: 200 },
          ),
        );
      });

      const result = yield* Effect.result(fetchIcpBrasilPadesPolicy({ timeoutMillis: 25 }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.POLICY_ERROR");
        expect(result.failure.reason).toContain("Timed out");
      }
      expect(aborted).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );
});
