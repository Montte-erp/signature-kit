import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime";
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Layer } from "effect";
import { liteParseWorkerBrowserLayer } from "@signature-kit/pdf/liteparse-browser";
import * as RpcServer from "effect/rpc/RpcServer";
import { A1WorkerRequests, a1WorkerHandlersLayer } from "./a1-worker.js";

BrowserRuntime.runMain(
  Layer.launch(
    RpcServer.layer(A1WorkerRequests).pipe(
      // effect-boundary: browser worker assembly [allow-provide: browser worker assembles its RPC handlers]
      Layer.provide(a1WorkerHandlersLayer.pipe(Layer.provide(liteParseWorkerBrowserLayer))),
      // effect-boundary: browser worker assembly [allow-provide: browser worker assembles its RPC transport]
      Layer.provide(
        RpcServer.layerProtocolWorkerRunner.pipe(
          // effect-boundary: browser worker assembly [allow-provide: browser worker supplies its platform runner]
          Layer.provide(BrowserWorkerRunner.layer),
        ),
      ),
    ),
  ),
);
