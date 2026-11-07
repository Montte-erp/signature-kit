import * as Domain from "@alchemy.run/domain";
import { SigningModel, SigningSession } from "@signature-kit/signing-domain";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { Deferred, Effect, Exit, Fiber, Layer, Ref, Result } from "effect";
import * as RpcTest from "effect/rpc/RpcTest";
import { expect, it } from "vitest";
import { createPdfFixture, readA1Fixture } from "../../../tooling/testing/fixtures";
import { SigningWorkerRequests } from "./signing-config";
import { makeSigningBatch, signingWorkerHandlersLayer } from "./signing-runtime";

const domainLayer = SigningModel.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory));

it("signs a real PDF and rejects bad passwords and stale generations", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SigningWorkerRequests);
        const pfx = yield* readA1Fixture("ecpf");
        const wrong = yield* Effect.result(client.Initialize({ pfx, password: "wrong" }));
        expect(Result.isFailure(wrong)).toBe(true);
        const first = yield* client.Initialize({ pfx, password: "changeit" });
        const input = { pdf: createPdfFixture(), signing: {} };
        const signed = yield* client.Sign({ generation: first.generation, input });
        expect(
          (yield* verifyPdfSignatures({ pdf: signed })).map((item) => item.cryptographicValid),
        ).toEqual([true]);
        const second = yield* client.Initialize({ pfx, password: "changeit" });
        expect(second.generation).toBeGreaterThan(first.generation);
        expect(
          Result.isFailure(
            yield* Effect.result(client.Sign({ generation: first.generation, input })),
          ),
        ).toBe(true);
        yield* client.Dispose();
        expect(
          Result.isFailure(
            yield* Effect.result(client.Sign({ generation: second.generation, input })),
          ),
        ).toBe(true);
      }),
    ).pipe(Effect.provide(signingWorkerHandlersLayer)),
  );
});

it("cancels an active batch and rejects a late completion", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const batch = yield* makeSigningBatch;
        const client = yield* RpcTest.makeClient(SigningWorkerRequests);
        const pfx = yield* readA1Fixture("ecpf");
        const initialized = yield* client.Initialize({ pfx, password: "changeit" });
        const sessions = yield* SigningSession;
        const gate = yield* Deferred.make<void>();
        const started = yield* Deferred.make<void>();
        const drained = yield* Ref.make(false);
        const signed = yield* Ref.make(false);
        const fiber = yield* Effect.forkChild(
          batch.run({
            target: "test",
            batchId: 1,
            generation: initialized.generation,
            documents: [{ id: "document", input: { pdf: createPdfFixture(), signing: {} } }],
            sign: (request) =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(Ref.set(signed, true)),
                Effect.andThen(client.Sign(request)),
                Effect.ensuring(Ref.set(drained, true)),
              ),
          }),
        );
        yield* Deferred.await(started);
        yield* batch.cancel("test", 1);
        yield* Deferred.succeed(gate, undefined);
        const result = yield* Fiber.await(fiber);
        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* Ref.get(drained)).toBe(true);
        expect(yield* Ref.get(signed)).toBe(false);
        expect((yield* sessions.state("test")).status).toBe("cancelled");
      }),
    ).pipe(Effect.provide(Layer.merge(domainLayer, signingWorkerHandlersLayer))),
  );
});

it("does not cancel an existing batch when another start is rejected", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const batch = yield* makeSigningBatch;
        const sessions = yield* SigningSession;
        const started = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<Uint8Array>();
        const options = {
          target: "shared",
          batchId: 1,
          generation: 1,
          documents: [{ id: "document", input: { pdf: createPdfFixture(), signing: {} } }],
          sign: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
        };
        const first = yield* Effect.forkChild(batch.run(options));
        yield* Deferred.await(started);
        const rejected = yield* Effect.result(batch.run({ ...options, batchId: 2 }));
        expect(Result.isFailure(rejected)).toBe(true);
        expect((yield* sessions.state("shared")).status).toBe("running");
        yield* batch.cancel("shared", 1);
        yield* Fiber.await(first);
        expect((yield* sessions.state("shared")).status).toBe("cancelled");
      }),
    ).pipe(Effect.provide(domainLayer)),
  );
});

it("records and cancels preparation before any signing request starts", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const batch = yield* makeSigningBatch;
        const sessions = yield* SigningSession;
        const client = yield* RpcTest.makeClient(SigningWorkerRequests);
        const started = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkChild(
          batch.run({
            target: "preparation",
            batchId: 1,
            documentIds: ["document"],
            prepare: Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(gate);
              return {
                generation: 1,
                documents: [{ id: "document", input: { pdf: createPdfFixture(), signing: {} } }],
                sign: client.Sign,
              };
            }),
          }),
        );
        yield* Deferred.await(started);
        const state = yield* sessions.state("preparation");
        expect(state.status).toBe("running");
        expect(state.mode).toBe("prepare");
        yield* batch.cancel("preparation", 1);
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
        expect((yield* sessions.state("preparation")).status).toBe("cancelled");
      }),
    ).pipe(Effect.provide(Layer.merge(domainLayer, signingWorkerHandlersLayer))),
  );
});

it("transitions from preparation to signing in the domain before completing", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const batch = yield* makeSigningBatch;
        const sessions = yield* SigningSession;
        const client = yield* RpcTest.makeClient(SigningWorkerRequests);
        const pfx = yield* readA1Fixture("ecpf");
        const phases: Array<string> = [];
        const result = yield* batch.run({
          target: "phases",
          batchId: 1,
          documentIds: ["document"],
          onState: (state) => {
            phases.push(`${state.status}:${state.mode}`);
          },
          prepare: Effect.gen(function* () {
            const state = yield* sessions.state("phases");
            expect(state.mode).toBe("prepare");
            const initialized = yield* client.Initialize({ pfx, password: "changeit" });
            return {
              generation: initialized.generation,
              documents: [{ id: "document", input: { pdf: createPdfFixture(), signing: {} } }],
              sign: client.Sign,
            };
          }),
        });
        expect(phases[0]).toBe("running:prepare");
        expect(phases).toContain("running:sign");
        expect(phases.at(-1)).toBe("completed:sign");
        const first = result[0];
        expect(first?.result._tag).toBe("Success");
        if (first !== undefined && Result.isSuccess(first.result)) {
          const signatures = yield* verifyPdfSignatures({ pdf: first.result.success });
          expect(signatures[0]?.cryptographicValid).toBe(true);
        }
      }),
    ).pipe(Effect.provide(Layer.merge(domainLayer, signingWorkerHandlersLayer))),
  );
});
