import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Clock, Deferred, Duration, Effect, Fiber, Redacted, Result } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { localHttpServer } from "../../../tooling/testing/local-http";
import { waitForZapSignSignatureRequest } from "../src/index";

const responseBody = (status: string) => JSON.stringify({ token: "7", status });

describe("ZapSign request polling", () => {
  it.effect("reads pending requests on the configured schedule and returns completion", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const times: number[] = [];
      const server = yield* localHttpServer(() => {
        times.push(clock.currentTimeMillisUnsafe());
        return Promise.resolve({
          status: 200,
          body: responseBody(times.length === 1 ? "pending" : "signed"),
        });
      });
      const done = yield* Deferred.make<void>();
      const fiber = yield* waitForZapSignSignatureRequest(
        { apiToken: Redacted.make("local-token"), baseUrl: server.baseUrl },
        "7",
        Duration.seconds(1),
      ).pipe(
        Effect.provide(signatureHttpClientLive),
        Effect.ensuring(Deferred.succeed(done, undefined)),
        Effect.forkChild,
      );
      yield* Effect.gen(function* () {
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Effect.yieldNow;
        return yield* Deferred.isDone(done);
      }).pipe(Effect.repeat({ until: (finished) => finished }));
      const result = yield* Fiber.join(fiber);
      expect(result.state).toBe("completed");
      expect(server.requests.map((request) => [request.method, request.pathname])).toEqual([
        ["GET", "/docs/7/"],
        ["GET", "/docs/7/"],
      ]);
      const [first, second] = times;
      if (first === undefined || second === undefined) expect.fail("Both reads must be recorded.");
      expect(second - first).toBeGreaterThanOrEqual(1000);
    }).pipe(Effect.scoped),
  );

  it.effect("returns a terminal cancellation immediately", () =>
    Effect.gen(function* () {
      const server = yield* localHttpServer(() =>
        Promise.resolve({ status: 200, body: responseBody("cancelled") }),
      );
      const result = yield* waitForZapSignSignatureRequest(
        { apiToken: Redacted.make("local-token"), baseUrl: server.baseUrl },
        "7",
        Duration.seconds(1),
      ).pipe(Effect.provide(signatureHttpClientLive));
      expect(result.state).toBe("cancelled");
      expect(server.requests).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects zero and infinite intervals before contacting the provider", () =>
    Effect.gen(function* () {
      const server = yield* localHttpServer(() => Promise.resolve({ status: 500 }));
      for (const interval of [Duration.zero, Duration.infinity]) {
        const result = yield* Effect.result(
          waitForZapSignSignatureRequest(
            { apiToken: Redacted.make("local-token"), baseUrl: server.baseUrl },
            "7",
            interval,
          ).pipe(Effect.provide(signatureHttpClientLive)),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result))
          expect(result.failure.code).toBe("signature-kit.INVALID_INPUT");
      }
      expect(server.requests).toHaveLength(0);
    }).pipe(Effect.scoped),
  );

  it.effect("preserves read failures without automatically retrying them", () =>
    Effect.gen(function* () {
      const server = yield* localHttpServer(() =>
        Promise.resolve({ status: 404, body: "missing" }),
      );
      const result = yield* Effect.result(
        waitForZapSignSignatureRequest(
          { apiToken: Redacted.make("local-token"), baseUrl: server.baseUrl },
          "7",
          Duration.seconds(1),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.status).toBe(404);
      expect(server.requests).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("interruption stops subsequent reads", () =>
    Effect.gen(function* () {
      const callbackContext = yield* Effect.context<never>();

      const read = yield* Deferred.make<void>();
      const server = yield* localHttpServer(() =>
        Effect.runPromiseWith(callbackContext)(Deferred.succeed(read, undefined)).then(() => ({
          status: 200,
          body: responseBody("pending"),
        })),
      );
      const fiber = yield* waitForZapSignSignatureRequest(
        { apiToken: Redacted.make("local-token"), baseUrl: server.baseUrl },
        "7",
        Duration.seconds(1),
      ).pipe(Effect.provide(signatureHttpClientLive), Effect.forkChild);
      yield* Deferred.await(read);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust(Duration.days(1));
      expect(server.requests).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});
