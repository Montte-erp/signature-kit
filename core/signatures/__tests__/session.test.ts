import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Result } from "effect";
import { SignatureSession, signatureSessionLayer } from "../src/session.js";
import type { SignerAdapter } from "../src/signatures.js";

const adapter: SignerAdapter = {
  id: "test",
  inspect: () => Effect.die("unused"),
  certificate: () => Effect.die("unused"),
  importSigningKey: () => Effect.die("unused"),
  sign: () => Effect.die("unused"),
  verify: () => Effect.die("unused"),
};

const layer = signatureSessionLayer({
  initialization: "initialization",
  unavailableReason: "operation",
});

describe("SignatureSession", () => {
  it.effect("dispose waits for the session resource finalizer", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const releasing = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      yield* session.initialize(
        Effect.acquireRelease(Effect.succeed({ adapter, value: 1 }), () =>
          Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(finish))),
        ),
      );
      const disposed = yield* Ref.make(false);
      const disposing = yield* Effect.forkChild(
        session.dispose().pipe(Effect.andThen(Ref.set(disposed, true))),
      );
      yield* Deferred.await(releasing);
      const secondDisposed = yield* Ref.make(false);
      const second = yield* Effect.forkChild(
        session.dispose().pipe(Effect.andThen(Ref.set(secondDisposed, true))),
      );
      yield* Effect.yieldNow;
      expect(yield* Ref.get(disposed)).toBe(false);
      expect(yield* Ref.get(secondDisposed)).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(disposing);
      yield* Fiber.join(second);
      expect(yield* Ref.get(secondDisposed)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.live("allows a resource finalizer to reenter dispose", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const finalized = yield* Ref.make(false);
      yield* session.initialize(
        Effect.acquireRelease(Effect.succeed({ adapter, value: undefined }), () =>
          session.dispose().pipe(Effect.andThen(Ref.set(finalized, true))),
        ),
      );
      yield* session.dispose().pipe(Effect.timeout("2 seconds"));
      expect(yield* Ref.get(finalized)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.live("dispose drains active use and preserves its service context", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const started = yield* Deferred.make<void>();
      const releasing = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const initialized = yield* session.initialize(Effect.succeed({ adapter, value: undefined }));
      const use = yield* Effect.forkChild(
        session.use(initialized.generation, () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                const available = yield* SignatureSession;
                expect(available).toBe(session);
                yield* Deferred.succeed(releasing, undefined);
                yield* Deferred.await(finish);
              }),
            ),
          ),
        ),
      );
      yield* Deferred.await(started);
      const disposed = yield* Ref.make(false);
      const disposal = yield* Effect.forkChild(
        session.dispose().pipe(Effect.andThen(Ref.set(disposed, true))),
      );
      yield* Deferred.await(releasing);
      expect(yield* Ref.get(disposed)).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(disposal).pipe(Effect.timeout("2 seconds"));
      yield* Fiber.await(use);
    }).pipe(Effect.provide(layer)),
  );

  it.live("allows an owned use finalizer to dispose while external callers await the drain", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const started = yield* Deferred.make<void>();
      const reentered = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const initialized = yield* session.initialize(Effect.succeed({ adapter, value: undefined }));
      const use = yield* Effect.forkChild(
        session.use(initialized.generation, () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              session
                .dispose()
                .pipe(
                  Effect.andThen(Deferred.succeed(reentered, undefined)),
                  Effect.andThen(Deferred.await(finish)),
                ),
            ),
          ),
        ),
      );
      yield* Deferred.await(started);
      const disposal = yield* Effect.forkChild(session.dispose());
      yield* Deferred.await(reentered).pipe(Effect.timeout("2 seconds"));
      const externalDone = yield* Ref.make(false);
      const external = yield* Effect.forkChild(
        session.dispose().pipe(Effect.andThen(Ref.set(externalDone, true))),
      );
      yield* Effect.yieldNow;
      expect(yield* Ref.get(externalDone)).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(disposal).pipe(Effect.timeout("2 seconds"));
      yield* Fiber.join(external).pipe(Effect.timeout("2 seconds"));
      yield* Fiber.await(use);
      expect(yield* Ref.get(externalDone)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("interrupting initialization interrupts acquisition and releases its resource", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const acquired = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(
        session.initialize(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () => Deferred.succeed(released, undefined));
            yield* Deferred.succeed(acquired, undefined);
            return yield* Effect.never;
          }),
        ),
      );
      yield* Deferred.await(acquired);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.await(released);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("interrupting a use interrupts its owned fiber before returning", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const initialized = yield* session.initialize(Effect.succeed({ adapter, value: undefined }));
      const fiber = yield* Effect.forkChild(
        session.use(initialized.generation, () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        ),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.await(stopped);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("releases partially acquired resources when initialization fails", () =>
    Effect.gen(function* () {
      const session = yield* SignatureSession;
      const released = yield* Ref.make(false);
      const result = yield* Effect.result(
        session.initialize(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () => Ref.set(released, true));
            return yield* Effect.fail("failed");
          }),
        ),
      );
      expect(Result.isFailure(result)).toBe(true);
      expect(yield* Ref.get(released)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});
