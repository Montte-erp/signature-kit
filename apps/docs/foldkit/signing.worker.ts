import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime";
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Layer } from "effect";
import * as RpcServer from "effect/rpc/RpcServer";
import { SigningWorkerRequests } from "./signing-config.js";
import { signingWorkerHandlersLayer } from "./signing-runtime.js";

BrowserRuntime.runMain(
  Layer.launch(
    RpcServer.layer(SigningWorkerRequests).pipe(
      Layer.provide(signingWorkerHandlersLayer),
      Layer.provide(
        RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(BrowserWorkerRunner.layer)),
      ),
    ),
  ),
);
