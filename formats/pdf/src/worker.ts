import { Context, Effect, Layer, Schema } from "effect";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSigningBatchPreparationInputSchema,
  PdfSigningBatchPreparationResultSchema,
  PdfStampPreviewInputSchema,
} from "./config.js";
import type { createPdfStampPreview } from "./stamp.js";
import type { preparePdfSigningBatch } from "./workflow.js";

export const PdfWorkerRequests = RpcGroup.make(
  Rpc.make("Preview", {
    payload: PdfStampPreviewInputSchema,
    success: Schema.Uint8Array,
    error: PdfError,
  }),
  Rpc.make("Prepare", {
    payload: PdfSigningBatchPreparationInputSchema,
    success: Schema.Array(PdfSigningBatchPreparationResultSchema),
    error: PdfError,
  }),
);

export class PdfWorker extends Context.Service<
  PdfWorker,
  {
    readonly prepare: typeof preparePdfSigningBatch;
    readonly preview: typeof createPdfStampPreview;
  }
>()("@signature-kit/pdf/PdfWorker") {}

export const pdfWorkerLayer = Layer.effect(
  PdfWorker,
  Effect.gen(function* () {
    const client = yield* RpcClient.make(PdfWorkerRequests);
    return {
      preview: (input) =>
        Schema.decodeUnknownEffect(PdfStampPreviewInputSchema)(input).pipe(
          Effect.mapError(
            (issue) =>
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "Invalid stamp preview dimensions or badge.",
                issueMessage: String(issue),
              }),
          ),
          Effect.flatMap((valid) => client.Preview(valid)),
          Effect.catchTag("RpcClientError", () =>
            Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "PDF stamp preview worker communication failed.",
              }),
            ),
          ),
        ),
      prepare: Effect.fn(function* (input, callbacks = {}) {
        const valid = yield* Schema.decodeUnknownEffect(PdfSigningBatchPreparationInputSchema)(
          input,
        ).pipe(
          Effect.mapError(
            (issue) =>
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.signField,
                schemaName: "PdfSigningBatchPreparationInput",
                reason: "PDF worker preparation input failed schema validation.",
                issueMessage: String(issue),
              }),
          ),
        );
        return yield* Effect.forEach(valid.documents, (document, index) =>
          client.Prepare({ ...valid, documents: [document] }).pipe(
            Effect.catchTag("RpcClientError", () =>
              Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.pdfLoadFailed,
                  retryable: false,
                  operation: PdfOperationValue.parse,
                  reason: "PDF worker communication failed.",
                }),
              ),
            ),
            Effect.tap((results) =>
              Effect.forEach(
                results,
                (result) =>
                  Effect.sync(() =>
                    callbacks.onItemSettled?.(result, index, input.documents.length),
                  ).pipe(Effect.exit),
                { discard: true },
              ),
            ),
            Effect.tap((results) =>
              Effect.forEach(
                results,
                (result) =>
                  Effect.suspend(
                    () =>
                      callbacks.yieldAfterItem?.(result, index, input.documents.length) ??
                      Effect.void,
                  ).pipe(Effect.exit),
                { discard: true },
              ),
            ),
          ),
        ).pipe(Effect.map((results) => results.flat()));
      }),
    } satisfies PdfWorker["Service"];
  }),
);
