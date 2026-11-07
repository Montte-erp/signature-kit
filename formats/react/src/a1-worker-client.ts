import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { Deferred, Effect, Exit, Layer, Option, Scope } from "effect";
import * as RpcClient from "effect/rpc/RpcClient";
import { SignatureKitError, SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { A1WorkerRequests } from "./a1-worker.js";

export const makeObservedA1WorkerSession = (onClose: (drained: boolean) => void) =>
  Effect.acquireRelease(
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const worker = yield* Effect.try({
          try: () =>
            new Worker(new URL("./a1.browser.worker.js", import.meta.url), { type: "module" }),
          catch: () =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.unsupportedOperation,
              retryable: false,
              reason: "A1 worker failed to start.",
            }),
        });
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => worker.terminate()),
        );
        const protocol = RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
          // effect-boundary: worker protocol assembly [allow-provide: worker runtime assembly boundary]
          Layer.provide(BrowserWorker.layer(() => worker)),
        );
        const client = yield* restore(
          Layer.buildWithScope(protocol, scope).pipe(
            Effect.flatMap((context) =>
              RpcClient.make(A1WorkerRequests).pipe(
                Effect.provideContext(context),
                Scope.provide(scope),
              ),
            ),
            Effect.catchTag("WorkerError", () =>
              Effect.fail(
                new SignatureKitError({
                  code: SignatureKitErrorCodeValue.unsupportedOperation,
                  retryable: false,
                  reason: "A1 worker transport failed to start.",
                }),
              ),
            ),
            Effect.onError(() => Scope.close(scope, Exit.void)),
          ),
        );
        const closed = yield* Deferred.make<boolean>();
        const close = yield* Effect.cached(
          client.Dispose().pipe(
            Effect.timeoutOption("2 seconds"),
            Effect.match({ onFailure: () => false, onSuccess: Option.isSome }),
            Effect.ensuring(Scope.close(scope, Exit.void)),
            Effect.tap((drained) => Deferred.succeed(closed, drained)),
            Effect.tap((drained) => Effect.sync(() => onClose(drained))),
          ),
        );
        return { client, close, closed: Deferred.await(closed) };
      }),
    ),
    (session) => session.close.pipe(Effect.asVoid),
    { interruptible: true },
  );

export const makeA1WorkerSession = makeObservedA1WorkerSession(() => {});
