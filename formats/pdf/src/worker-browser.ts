import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { Effect, Layer } from "effect";
import * as RpcClient from "effect/rpc/RpcClient";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config.js";
import { pdfWorkerLayer } from "./worker.js";

export const pdfWorkerBrowserLayer = (
  create: () => Worker = () =>
    new Worker(new URL("./browser.worker.js", import.meta.url), { type: "module" }),
) =>
  Layer.unwrap(
    Effect.acquireRelease(
      Effect.try({
        try: create,
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.pdfLoadFailed,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason: "PDF worker failed to start.",
          }),
      }),
      (worker) => Effect.sync(() => worker.terminate()),
    ).pipe(
      Effect.map((worker) =>
        pdfWorkerLayer.pipe(
          Layer.provide(
            RpcClient.layerProtocolWorker({ size: 1, concurrency: 1 }).pipe(
              Layer.provide(BrowserWorker.layer(() => worker)),
              Layer.catchTag("WorkerError", () =>
                Layer.effect(
                  RpcClient.Protocol,
                  Effect.fail(
                    new PdfError({
                      code: PdfErrorCodeValue.pdfLoadFailed,
                      retryable: false,
                      operation: PdfOperationValue.parse,
                      reason: "PDF worker transport failed to start.",
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
