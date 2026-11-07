import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import {
  CancelBatch,
  CompleteBatch,
  CompleteDocument,
  FailBatch,
  FailDocument,
  SigningModel,
  SigningSession,
  StartBatch,
  StartDocument,
} from "../src/signing";

import type { InvalidTransition } from "../src/signing";

const layer = SigningModel.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory));

const expectRejectedWithoutChange = <A>(command: Effect.Effect<A, InvalidTransition>) =>
  Effect.gen(function* () {
    const sessions = yield* SigningSession;
    const before = yield* sessions.state("one");
    const result = yield* Effect.result(command);
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidTransition" } });
    expect(yield* sessions.state("one")).toEqual(before);
  });

it.live("records sequential progress and allows individual failures", () =>
  Effect.gen(function* () {
    const sessions = yield* SigningSession;
    yield* sessions.send(
      "one",
      new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a", "b"] }),
    );
    yield* sessions.send("one", new StartDocument({ batchId: 1, documentId: "a" }));
    yield* sessions.send("one", new CompleteDocument({ batchId: 1, documentId: "a" }));
    yield* sessions.send("one", new StartDocument({ batchId: 1, documentId: "b" }));
    yield* sessions.send("one", new FailDocument({ batchId: 1, documentId: "b" }));
    yield* sessions.send("one", new CompleteBatch({ batchId: 1 }));
    expect(yield* sessions.state("one")).toEqual({
      batchId: 1,
      mode: "sign",
      status: "completed",
      activeDocumentId: null,
      documents: [
        { id: "a", status: "completed" },
        { id: "b", status: "failed" },
      ],
    });
    expect((yield* sessions.state("other")).status).toBe("idle");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.live("cancellation and a newer batch reject late callbacks and simultaneous work", () =>
  Effect.gen(function* () {
    const sessions = yield* SigningSession;
    yield* sessions.send(
      "one",
      new StartBatch({ batchId: 1, mode: "prepare", documentIds: ["a", "b"] }),
    );
    yield* sessions.send("one", new StartDocument({ batchId: 1, documentId: "a" }));
    yield* expectRejectedWithoutChange(
      sessions.send("one", new StartDocument({ batchId: 1, documentId: "b" })),
    );
    yield* sessions.send("one", new CancelBatch({ batchId: 1 }));
    expect((yield* sessions.state("one")).documents.map((d) => d.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    yield* expectRejectedWithoutChange(
      sessions.send("one", new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a"] })),
    );
    yield* sessions.send("one", new StartBatch({ batchId: 2, mode: "sign", documentIds: ["a"] }));
    yield* sessions.send("one", new StartDocument({ batchId: 2, documentId: "a" }));
    yield* expectRejectedWithoutChange(
      sessions.send("one", new CompleteDocument({ batchId: 1, documentId: "a" })),
    );
    yield* expectRejectedWithoutChange(
      sessions.send("one", new FailDocument({ batchId: 1, documentId: "a" })),
    );
    expect(yield* sessions.state("one")).toEqual({
      batchId: 2,
      mode: "sign",
      status: "running",
      activeDocumentId: "a",
      documents: [{ id: "a", status: "working" }],
    });
    yield* expectRejectedWithoutChange(
      sessions.send("one", new StartBatch({ batchId: 3, mode: "sign", documentIds: ["a"] })),
    );
    yield* sessions.send("one", new FailBatch({ batchId: 2 }));
    expect((yield* sessions.state("one")).documents[0]?.status).toBe("failed");
    yield* expectRejectedWithoutChange(
      sessions.send("one", new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a"] })),
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.live("rejects invalid, duplicate, oversized and out-of-order work without changing state", () =>
  Effect.gen(function* () {
    const sessions = yield* SigningSession;
    for (const batchId of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const before = yield* sessions.state("one");
      const result = yield* Effect.result(
        Schema.decodeUnknownEffect(StartBatch)({
          _tag: "StartBatch",
          batchId,
          mode: "sign",
          documentIds: ["a"],
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      expect(yield* sessions.state("one")).toEqual(before);
    }
    for (const batchId of [0, -1]) {
      yield* expectRejectedWithoutChange(
        sessions.send("one", new StartBatch({ batchId, mode: "sign", documentIds: ["a"] })),
      );
    }
    for (const documentIds of [[], ["a", "a"], Array.from({ length: 101 }, (_, i) => `${i}`)]) {
      yield* expectRejectedWithoutChange(
        sessions.send("one", new StartBatch({ batchId: 1, mode: "sign", documentIds })),
      );
    }
    yield* sessions.send(
      "one",
      new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a", "b"] }),
    );
    yield* expectRejectedWithoutChange(
      sessions.send("one", new StartDocument({ batchId: 1, documentId: "b" })),
    );
    yield* expectRejectedWithoutChange(sessions.send("one", new CompleteBatch({ batchId: 1 })));
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.live("serializes competing starts per session and isolates different sessions", () =>
  Effect.gen(function* () {
    const sessions = yield* SigningSession;
    const starts = yield* Effect.all(
      [
        Effect.result(
          sessions.send("one", new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a"] })),
        ),
        Effect.result(
          sessions.send("one", new StartBatch({ batchId: 2, mode: "sign", documentIds: ["b"] })),
        ),
        Effect.result(
          sessions.send("two", new StartBatch({ batchId: 1, mode: "prepare", documentIds: ["c"] })),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const accepted = starts.slice(0, 2).filter(Result.isSuccess);
    const rejected = starts.slice(0, 2).filter(Result.isFailure);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidTransition" } });
    const event = accepted[0]?.success.events[0];
    expect(event?._tag).toBe("BatchStarted");
    if (event?._tag === "BatchStarted") {
      expect(yield* sessions.state("one")).toEqual({
        batchId: event.batchId,
        mode: event.mode,
        status: "running",
        activeDocumentId: null,
        documents: event.documentIds.map((id) => ({ id, status: "queued" })),
      });
    }
    expect(Result.isSuccess(starts[2])).toBe(true);
    expect((yield* sessions.state("two")).documents).toEqual([{ id: "c", status: "queued" }]);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.live(
  "a processed batch completes even if every document failed, and events carry metadata only",
  () =>
    Effect.gen(function* () {
      const sessions = yield* SigningSession;
      const start = yield* sessions.send(
        "one",
        new StartBatch({ batchId: 1, mode: "sign", documentIds: ["a"] }),
      );
      yield* sessions.send("one", new StartDocument({ batchId: 1, documentId: "a" }));
      const failed = yield* sessions.send("one", new FailDocument({ batchId: 1, documentId: "a" }));
      yield* sessions.send("one", new CompleteBatch({ batchId: 1 }));
      expect((yield* sessions.state("one")).status).toBe("completed");
      expect((yield* sessions.state("one")).documents[0]?.status).toBe("failed");
      expect(structuredClone(start.events)).toEqual([
        { _tag: "BatchStarted", batchId: 1, mode: "sign", documentIds: ["a"] },
      ]);
      expect(structuredClone(failed.events)).toEqual([{ _tag: "DocumentFailed", documentId: "a" }]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
);
