import { loadA1SignerAdapter, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import { liteParseWorkerBrowserLayer } from "@signature-kit/pdf/liteparse-browser";
import { prepareAndSignPdf, preparePdfVisualPreview } from "@signature-kit/pdf/workflow";
import {
  Signatures,
  SignatureKitError,
  SignatureKitErrorCodeValue,
} from "@signature-kit/signatures";
import { SignatureSession, signatureSessionLayer } from "@signature-kit/signatures/session";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Scope,
  Semaphore,
} from "effect";
import type { Schema } from "effect";
import { SigningWorkerRequests } from "./signing-config.js";

export const signingWorkerHandlersLayer = SigningWorkerRequests.toLayer(
  Effect.gen(function* () {
    const session = yield* SignatureSession;
    return SigningWorkerRequests.of({
      Initialize: Effect.fn(function* (input) {
        const options = { pfx: input.pfx, password: Redacted.make(input.password) };
        const loaded = yield* session.initialize(
          Effect.gen(function* () {
            const profile = yield* parseA1CertificateProfile(options);
            const adapter = yield* loadA1SignerAdapter(options);
            return { adapter, value: profile };
          }),
        );
        return { generation: loaded.generation, profile: loaded.value };
      }),
      Preview: (input) =>
        preparePdfVisualPreview(input).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
      Sign: ({ generation, input }) =>
        session.use(generation, (adapter) =>
          prepareAndSignPdf(input).pipe(
            Effect.provide(
              Layer.merge(Layer.succeed(Signatures, adapter), liteParseWorkerBrowserLayer),
            ),
          ),
        ),
      Dispose: session.dispose,
    });
  }),
).pipe(
  Layer.provide(
    signatureSessionLayer({
      initialization: "A1 worker session was replaced or disposed.",
      unavailableReason: "A1 worker session is not initialized or has been replaced.",
    }),
  ),
);

import {
  CancelBatch,
  CompleteBatch,
  CompleteDocument,
  FailBatch,
  FailDocument,
  SigningSession,
  StartBatch,
  StartSigning,
  StartDocument,
} from "@signature-kit/signing-domain";
import type { SigningState } from "@signature-kit/signing-domain";
import type { PdfError, PdfPrepareAndSignInput } from "@signature-kit/pdf/config";
import type { CmsError } from "@signature-kit/cms/config";
import type { RpcClientError } from "effect/rpc/RpcClientError";

export const makeSigningBatch = Effect.gen(function* () {
  const sessions = yield* SigningSession;
  const lock = yield* Semaphore.make(1);
  const active = yield* Ref.make(
    new Map<string, { readonly batchId: number; readonly fiber: Fiber.Fiber<unknown, unknown> }>(),
  );
  const cancel = (target: string, batchId: number) =>
    Effect.gen(function* () {
      const current = yield* Semaphore.withPermit(lock)(
        Ref.get(active).pipe(Effect.map((entries) => entries.get(target))),
      );
      if (current !== undefined && current.batchId === batchId)
        yield* Fiber.interrupt(current.fiber);
    });
  type PreparedBatch = {
    readonly generation: number;
    readonly documents: ReadonlyArray<{
      readonly id: string;
      readonly input: PdfPrepareAndSignInput;
    }>;
    readonly sign: (request: {
      readonly generation: number;
      readonly input: PdfPrepareAndSignInput;
    }) => Effect.Effect<Uint8Array, PdfError | CmsError | SignatureKitError | RpcClientError>;
  };
  const run = (
    options: {
      readonly target: string;
      readonly batchId: number;
      readonly onState?: (state: Schema.Schema.Type<typeof SigningState>) => void;
    } & (
      | PreparedBatch
      | {
          readonly documentIds: ReadonlyArray<string>;
          readonly prepare: Effect.Effect<
            PreparedBatch,
            PdfError | CmsError | SignatureKitError | RpcClientError,
            Scope.Scope
          >;
        }
    ),
  ) => {
    const { target, batchId } = options;
    const publishState = sessions
      .state(target)
      .pipe(Effect.tap((state) => Effect.sync(() => options.onState?.(state))));
    const documentIds =
      "prepare" in options ? options.documentIds : options.documents.map((document) => document.id);
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const fiber = yield* Semaphore.withPermit(lock)(
          Effect.gen(function* () {
            yield* sessions.send(
              target,
              new StartBatch({
                batchId,
                mode: "prepare" in options ? "prepare" : "sign",
                documentIds,
              }),
            );
            yield* publishState;
            const work = Effect.gen(function* () {
              const prepared = "prepare" in options ? yield* options.prepare : options;
              const { documents, generation, sign } = prepared;
              if ("prepare" in options) {
                yield* sessions.send(target, new StartSigning({ batchId }));
                yield* publishState;
              }
              const results = yield* Effect.forEach(documents, (document) =>
                Effect.gen(function* () {
                  yield* Semaphore.withPermit(lock)(
                    sessions.send(target, new StartDocument({ batchId, documentId: document.id })),
                  );
                  yield* publishState;
                  const signed = yield* Effect.result(sign({ generation, input: document.input }));
                  yield* Semaphore.withPermit(lock)(
                    signed._tag === "Success"
                      ? sessions.send(
                          target,
                          new CompleteDocument({ batchId, documentId: document.id }),
                        )
                      : sessions.send(
                          target,
                          new FailDocument({ batchId, documentId: document.id }),
                        ),
                  );
                  yield* publishState;
                  return { id: document.id, result: signed };
                }),
              );
              yield* Semaphore.withPermit(lock)(
                sessions.send(target, new CompleteBatch({ batchId })),
              );
              yield* publishState;
              return results;
            });
            const cleanup = (cancelled: boolean) =>
              Semaphore.withPermit(lock)(
                Effect.gen(function* () {
                  const state = yield* sessions.state(target);
                  if (state.status === "running" && state.batchId === batchId) {
                    yield* sessions.send(
                      target,
                      cancelled ? new CancelBatch({ batchId }) : new FailBatch({ batchId }),
                    );
                    yield* publishState;
                  }
                }),
              );
            const child = yield* Effect.forkChild(
              work.pipe(
                Effect.onInterrupt(() => cleanup(true).pipe(Effect.orDie)),
                Effect.onError(() => cleanup(false).pipe(Effect.orDie)),
              ),
              { uninterruptible: false },
            );
            yield* Ref.update(active, (entries) =>
              new Map(entries).set(target, { batchId, fiber: child }),
            );
            return child;
          }),
        );
        return yield* restore(Fiber.join(fiber)).pipe(
          Effect.onInterrupt(() => Fiber.interrupt(fiber)),
          Effect.ensuring(
            Semaphore.withPermit(lock)(
              Ref.update(active, (entries) => {
                if (entries.get(target)?.fiber !== fiber) return entries;
                const next = new Map(entries);
                next.delete(target);
                return next;
              }),
            ),
          ),
        );
      }),
    );
  };
  return { run, cancel };
});

import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import * as RpcClient from "effect/rpc/RpcClient";

export const makeSigningWorkerSession = Effect.acquireRelease(
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const worker = yield* Effect.try({
        try: () => new Worker(new URL("./signing.worker.ts", import.meta.url), { type: "module" }),
        catch: () =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.unsupportedOperation,
            retryable: false,
            reason: "Signing worker failed to start.",
          }),
      });
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => worker.terminate()),
      );
      const protocol = RpcClient.layerProtocolWorker({ size: 1, concurrency: 16 }).pipe(
        Layer.provide(BrowserWorker.layer(() => worker)),
      );
      return yield* restore(
        Layer.buildWithScope(protocol, scope).pipe(
          Effect.catchTag("WorkerError", () =>
            Effect.fail(
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.unsupportedOperation,
                retryable: false,
                reason: "Signing worker transport failed to start.",
              }),
            ),
          ),
          Effect.flatMap((context) =>
            RpcClient.make(SigningWorkerRequests).pipe(
              Effect.provideContext(context),
              Scope.provide(scope),
            ),
          ),
          Effect.flatMap((client) =>
            Effect.gen(function* () {
              const closed = yield* Deferred.make<boolean>();
              const close = yield* Effect.cached(
                client.Dispose().pipe(
                  Effect.timeoutOption("2 seconds"),
                  Effect.match({ onFailure: () => false, onSuccess: Option.isSome }),
                  Effect.ensuring(Scope.close(scope, Exit.void)),
                  Effect.tap((drained) => Deferred.succeed(closed, drained)),
                ),
              );
              return { client, close, closed: Deferred.await(closed) };
            }),
          ),
        ),
      ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
    }),
  ),
  (session) => session.close.pipe(Effect.asVoid),
  { interruptible: true },
);
