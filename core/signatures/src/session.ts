import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope, Semaphore } from "effect";
import { SignatureKitError, SignatureKitErrorCodeValue } from "./signatures.js";
import type { SignerAdapter } from "./signatures.js";

type Session = {
  readonly generation: number;
  readonly scope: Scope.Closeable;
  readonly adapter: SignerAdapter | null;
};

type SessionService = {
  readonly initialize: <A, E, R>(
    acquire: Effect.Effect<{ readonly adapter: SignerAdapter; readonly value: A }, E, R>,
  ) => Effect.Effect<
    { readonly generation: number; readonly value: A },
    E | SignatureKitError,
    Exclude<R, Scope.Scope>
  >;
  readonly use: <A, E, R>(
    generation: number,
    run: (adapter: SignerAdapter) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SignatureKitError, R>;
  readonly dispose: () => Effect.Effect<void>;
};

export class SignatureSession extends Context.Service<SignatureSession, SessionService>()(
  "@signature-kit/signatures/SignatureSession",
) {}

export const signatureSessionLayer = (reasons: {
  readonly initialization: string;
  readonly unavailableReason: string;
}) =>
  Layer.effect(
    SignatureSession,
    Effect.gen(function* () {
      const session = yield* Ref.make<Session | null>(null);
      const generation = yield* Ref.make(0);
      const lock = yield* Semaphore.make(1);
      const owned = yield* Ref.make<
        ReadonlyArray<{ readonly fiber: number; readonly scope: Scope.Closeable }>
      >([]);
      const closing = yield* Ref.make<
        ReadonlyArray<{
          readonly owner: number;
          readonly scope: Scope.Closeable;
          readonly done: Deferred.Deferred<void>;
        }>
      >([]);
      const inScope = <A, E, R>(effect: Effect.Effect<A, E, R>, scope: Scope.Closeable) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.fiberId;
            yield* Ref.update(owned, (items) => [...items, { fiber, scope }]);
            return yield* restore(effect).pipe(
              Effect.ensuring(
                Ref.update(owned, (items) => items.filter((item) => item.fiber !== fiber)),
              ),
            );
          }),
        );
      const detach = Effect.gen(function* () {
        const owner = yield* Effect.fiberId;
        const previous = yield* Ref.getAndSet(session, null);
        const pending = yield* Ref.get(closing);
        const done = previous === null ? null : yield* Deferred.make<void>();
        if (done !== null && previous !== null)
          yield* Ref.update(closing, (items) => [...items, { owner, scope: previous.scope, done }]);
        return { previous, pending, done, owner };
      });
      const drain = (
        detached: {
          readonly previous: Session | null;
          readonly pending: ReadonlyArray<{
            readonly owner: number;
            readonly scope: Scope.Closeable;
            readonly done: Deferred.Deferred<void>;
          }>;
          readonly done: Deferred.Deferred<void> | null;
          readonly owner: number;
        },
        exit: Exit.Exit<unknown, unknown>,
      ) =>
        Effect.gen(function* () {
          if (detached.previous !== null && detached.done !== null) {
            const done = detached.done;
            yield* Scope.close(detached.previous.scope, exit).pipe(
              Effect.ensuring(
                Deferred.succeed(done, undefined).pipe(
                  Effect.andThen(
                    Ref.update(closing, (items) => items.filter((item) => item.done !== done)),
                  ),
                ),
              ),
            );
          }
          const fibers = yield* Ref.get(owned);
          yield* Effect.forEach(
            detached.pending,
            (item) =>
              item.owner === detached.owner ||
              fibers.some((entry) => entry.fiber === detached.owner && entry.scope === item.scope)
                ? Effect.void
                : Deferred.await(item.done),
            { discard: true },
          );
        });
      const dispose = () =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const detached = yield* Semaphore.withPermit(lock)(detach);
            yield* drain(detached, Exit.void);
          }),
        );
      yield* Effect.addFinalizer(dispose);
      return SignatureSession.of({
        initialize: Effect.fn((acquire) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const started = yield* Semaphore.withPermit(lock)(
                Effect.uninterruptible(
                  Effect.gen(function* () {
                    const detached = yield* detach;
                    const next = yield* Ref.updateAndGet(generation, (value) => value + 1);
                    const scope = yield* Scope.make();
                    yield* Ref.set(session, { generation: next, scope, adapter: null });
                    return { next, scope, detached };
                  }),
                ),
              );
              yield* drain(started.detached, Exit.void);
              const fiber = yield* Semaphore.withPermit(lock)(
                Effect.gen(function* () {
                  const current = yield* Ref.get(session);
                  if (current === null || current.generation !== started.next) {
                    return yield* new SignatureKitError({
                      code: SignatureKitErrorCodeValue.invalidInput,
                      retryable: false,
                      reason: reasons.initialization,
                    });
                  }
                  return yield* Effect.forkIn(
                    inScope(Scope.provide(acquire, started.scope), started.scope),
                    started.scope,
                    {
                      uninterruptible: false,
                    },
                  );
                }),
              );
              const loaded = yield* restore(Fiber.join(fiber)).pipe(
                Effect.onExit((exit) =>
                  Exit.isFailure(exit)
                    ? Effect.gen(function* () {
                        yield* Fiber.interrupt(fiber);
                        const detached = yield* Semaphore.withPermit(lock)(
                          Effect.gen(function* () {
                            const current = yield* Ref.get(session);
                            return current !== null && current.generation === started.next
                              ? yield* detach
                              : null;
                          }),
                        );
                        if (detached !== null) yield* drain(detached, exit);
                      })
                    : Effect.void,
                ),
              );
              return yield* Semaphore.withPermit(lock)(
                Effect.gen(function* () {
                  const current = yield* Ref.get(session);
                  if (current === null || current.generation !== started.next) {
                    return yield* new SignatureKitError({
                      code: SignatureKitErrorCodeValue.invalidInput,
                      retryable: false,
                      reason: reasons.initialization,
                    });
                  }
                  yield* Ref.set(session, { ...current, adapter: loaded.adapter });
                  return { generation: current.generation, value: loaded.value };
                }),
              );
            }),
          ),
        ),
        use: Effect.fn((requested, run) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const fiber = yield* Semaphore.withPermit(lock)(
                Effect.uninterruptible(
                  Effect.gen(function* () {
                    const current = yield* Ref.get(session);
                    if (
                      current === null ||
                      current.adapter === null ||
                      current.generation !== requested
                    ) {
                      return yield* new SignatureKitError({
                        code: SignatureKitErrorCodeValue.invalidInput,
                        retryable: false,
                        reason: reasons.unavailableReason,
                      });
                    }
                    return yield* Effect.forkIn(
                      inScope(run(current.adapter), current.scope),
                      current.scope,
                      {
                        uninterruptible: false,
                      },
                    );
                  }),
                ),
              );
              const result = yield* restore(Fiber.join(fiber)).pipe(
                Effect.onInterrupt(() => Fiber.interrupt(fiber)),
              );
              return yield* Semaphore.withPermit(lock)(
                Effect.gen(function* () {
                  const current = yield* Ref.get(session);
                  if (current === null || current.generation !== requested) {
                    return yield* new SignatureKitError({
                      code: SignatureKitErrorCodeValue.invalidInput,
                      retryable: false,
                      reason: reasons.unavailableReason,
                    });
                  }
                  return result;
                }),
              );
            }),
          ),
        ),
        dispose,
      });
    }),
  );
