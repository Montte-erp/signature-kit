import { Deferred, Effect, Exit, Fiber, Layer, Result } from "effect";
import { liteParseWorkerBrowserLayer } from "@signature-kit/pdf/liteparse-browser";
import * as RpcTest from "effect/rpc/RpcTest";
import { expect, it } from "vitest";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";
import { A1WorkerRequests, a1WorkerHandlersLayer } from "../src/a1-worker";
import { makeA1WorkerSession } from "../src/a1-worker-client";

const createPdf = (): Uint8Array => {
  const source = [
    "%PDF-1.4",
    "%\xE2\xE3\xCF\xD3",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Length 15 >> stream",
    "BT /F1 24 Tf ET",
    "endstream",
    "endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000010 00000 n ",
    "0000000071 00000 n ",
    "0000000131 00000 n ",
    "0000000256 00000 n ",
    "0000000321 00000 n ",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "402",
    "%%EOF",
  ];

  return new TextEncoder().encode(source.join("\n"));
};

it("signs with the current generation and rejects disposed and replaced sessions", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(A1WorkerRequests);
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const first = yield* client.Initialize({ pfx, password: "changeit" });
        const pdf = createPdf();
        const input = { pdf, documentId: "document", signing: {} };
        const signed = yield* client.Sign({
          generation: first.generation,
          input,
        });
        const verified = yield* verifyPdfSignatures({ pdf: signed });
        expect(verified.map((item) => item.cryptographicValid)).toEqual([true]);
        const second = yield* client.Initialize({ pfx, password: "changeit" });
        expect(second.generation).toBeGreaterThan(first.generation);
        const stale = yield* Effect.result(client.Sign({ generation: first.generation, input }));
        expect(Result.isFailure(stale)).toBe(true);
        if (Result.isFailure(stale)) {
          expect(stale.failure._tag).toBe("SignatureKitError");
          expect(stale.failure.code).toBe(SignatureKitErrorCodeValue.invalidInput);
          expect(stale.failure.reason).toBe(
            "A1 worker session is not initialized or has been replaced.",
          );
        }
        yield* client.Dispose();
        const disposed = yield* Effect.result(
          client.Sign({ generation: second.generation, input }),
        );
        expect(Result.isFailure(disposed)).toBe(true);
        if (Result.isFailure(disposed)) {
          expect(disposed.failure._tag).toBe("SignatureKitError");
          expect(disposed.failure.code).toBe(SignatureKitErrorCodeValue.invalidInput);
          expect(disposed.failure.reason).toBe(
            "A1 worker session is not initialized or has been replaced.",
          );
        }
      }),
    ).pipe(Effect.provide(a1WorkerHandlersLayer.pipe(Layer.provide(liteParseWorkerBrowserLayer)))),
  );
});

it("does not restore a session after disposal races initialization", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(A1WorkerRequests);
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const initializing = yield* Effect.forkChild(
          client.Initialize({ pfx, password: "changeit" }),
        );
        yield* Effect.yieldNow;
        yield* client.Dispose();
        const result = yield* Fiber.await(initializing);
        if (Exit.isSuccess(result)) {
          const rejected = yield* Effect.result(
            client.Sign({
              generation: result.value.generation,
              input: {
                pdf: createPdf(),
                documentId: "document",
                signing: {},
              },
            }),
          );
          expect(Result.isFailure(rejected)).toBe(true);
          if (Result.isFailure(rejected)) {
            expect(rejected.failure._tag).toBe("SignatureKitError");
            expect(rejected.failure.code).toBe(SignatureKitErrorCodeValue.invalidInput);
            expect(rejected.failure.reason).toBe(
              "A1 worker session is not initialized or has been replaced.",
            );
          }
        }
        const next = yield* client.Initialize({ pfx, password: "changeit" });
        yield* client.Dispose();
        const rejected = yield* Effect.result(
          client.Sign({
            generation: next.generation,
            input: {
              pdf: createPdf(),
              documentId: "document",
              signing: {},
            },
          }),
        );
        expect(Result.isFailure(rejected)).toBe(true);
        if (Result.isFailure(rejected)) {
          expect(rejected.failure._tag).toBe("SignatureKitError");
          expect(rejected.failure.code).toBe(SignatureKitErrorCodeValue.invalidInput);
          expect(rejected.failure.reason).toBe(
            "A1 worker session is not initialized or has been replaced.",
          );
        }
      }),
    ).pipe(Effect.provide(a1WorkerHandlersLayer.pipe(Layer.provide(liteParseWorkerBrowserLayer)))),
  );
});

it("closes a real worker when interruption reaches the acquisition handoff", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Deferred.make<Effect.Success<typeof makeA1WorkerSession>>();
        const release = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const session = yield* restore(makeA1WorkerSession);
                yield* Deferred.succeed(acquired, session);
                yield* restore(Deferred.await(release));
              }),
            ),
          ),
        );
        const session = yield* Deferred.await(acquired);
        yield* Fiber.interrupt(fiber);
        expect(yield* session.closed.pipe(Effect.timeout("5 seconds"))).toBe(true);
      }),
    ),
  );
}, 30000);

it("closes a real worker when initialization fails after acquisition", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const acquired = yield* Deferred.make<Effect.Success<typeof makeA1WorkerSession>>();
      const failed = yield* Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* makeA1WorkerSession;
            yield* Deferred.succeed(acquired, session);
            return yield* session.client.Initialize({
              pfx: new Uint8Array([0]),
              password: "invalid",
            });
          }),
        ),
      );
      expect(Result.isFailure(failed)).toBe(true);
      const session = yield* Deferred.await(acquired);
      expect(yield* session.closed.pipe(Effect.timeout("5 seconds"))).toBe(true);
    }),
  );
}, 30000);
