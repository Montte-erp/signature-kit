import { loadA1SignerAdapter } from "@signature-kit/a1/signer";
import { SignatureSession, signatureSessionLayer } from "@signature-kit/signatures/session";
import { Deferred, Effect, Exit, Fiber, Redacted, Ref } from "effect";
import { expect, it } from "vitest";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";

it("drains an active operation on replacement and rejects the old generation", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* SignatureSession;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const adapter = yield* loadA1SignerAdapter({ pfx, password: Redacted.make("changeit") });
        const first = yield* session.initialize(Effect.succeed({ adapter, value: undefined }));
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const cleaned = yield* Ref.make(false);
        const operation = yield* Effect.forkChild(
          session.use(first.generation, () =>
            Effect.uninterruptible(
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.ensuring(Ref.set(cleaned, true)),
              ),
            ),
          ),
        );
        yield* Deferred.await(started);
        const replacement = yield* Effect.forkChild(
          session.initialize(Effect.succeed({ adapter, value: undefined })),
        );
        yield* Effect.yieldNow;
        expect(yield* Ref.get(cleaned)).toBe(false);
        yield* Deferred.succeed(release, undefined);
        const second = yield* Fiber.join(replacement);
        expect(yield* Ref.get(cleaned)).toBe(true);
        expect(second.generation).toBeGreaterThan(first.generation);
        expect(Exit.isFailure(yield* Fiber.await(operation))).toBe(true);
        expect(
          Exit.isFailure(yield* Effect.exit(session.use(first.generation, () => Effect.void))),
        ).toBe(true);
        yield* session.dispose();
        expect(
          Exit.isFailure(yield* Effect.exit(session.use(second.generation, () => Effect.void))),
        ).toBe(true);
      }),
    ).pipe(
      Effect.provide(
        signatureSessionLayer({ initialization: "replaced", unavailableReason: "stale" }),
      ),
    ),
  );
});

it("drains initialization on disposal without restoring its session", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* SignatureSession;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const adapter = yield* loadA1SignerAdapter({ pfx, password: Redacted.make("changeit") });
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const cleaned = yield* Ref.make(false);
        const initialization = yield* Effect.forkChild(
          session.initialize(
            Effect.uninterruptible(
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as({ adapter, value: undefined }),
                Effect.ensuring(Ref.set(cleaned, true)),
              ),
            ),
          ),
        );
        yield* Deferred.await(started);
        const disposal = yield* Effect.forkChild(session.dispose());
        yield* Effect.yieldNow;
        expect(yield* Ref.get(cleaned)).toBe(false);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(disposal);
        expect(yield* Ref.get(cleaned)).toBe(true);
        expect(Exit.isFailure(yield* Fiber.await(initialization))).toBe(true);
        expect(Exit.isFailure(yield* Effect.exit(session.use(1, () => Effect.void)))).toBe(true);
      }),
    ).pipe(
      Effect.provide(
        signatureSessionLayer({ initialization: "replaced", unavailableReason: "stale" }),
      ),
    ),
  );
});
