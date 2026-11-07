import { Effect, Exit, Scope } from "effect";
import { expect, it } from "vitest";
import { makeSigningWorkerSession } from "./signing-runtime";

it("closes a real worker when its caller scope closes", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const session = yield* makeSigningWorkerSession.pipe(Scope.provide(scope));
        yield* Scope.close(scope, Exit.void);
        expect(yield* session.closed.pipe(Effect.timeout("5 seconds"))).toBe(true);
        expect(yield* session.close).toBe(true);
      }),
    ),
  );
});

it("shares explicit disposal with the caller scope finalizer", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const session = yield* makeSigningWorkerSession.pipe(Scope.provide(scope));
        expect(yield* session.close).toBe(true);
        yield* Scope.close(scope, Exit.void);
        expect(yield* session.close).toBe(true);
      }),
    ),
  );
});
