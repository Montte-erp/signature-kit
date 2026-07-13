import initLiteParseWasm, { LiteParse } from "@llamaindex/liteparse-wasm";
import { Schema } from "effect";

import { hasBoundedPdfLiteParseResult, PdfLiteParseResultSchemaForPageCount } from "./config.js";
import { LiteParseWorkerRequestSchema } from "./liteparse-browser-protocol.js";
import type { LiteParseWorkerRequest } from "./liteparse-browser-protocol.js";

const isLiteParseWorkerRequest = Schema.is(LiteParseWorkerRequestSchema);

const parseLiteParseRequest = (request: LiteParseWorkerRequest): Promise<unknown> =>
  initLiteParseWasm().then(() => {
    const parser = new LiteParse({
      ocrEnabled: false,
      maxPages: request.pageCount,
      outputFormat: "json",
      preserveVerySmallText: true,
      quiet: true,
    });
    return Promise.resolve()
      .then(() => parser.parse(request.pdf))
      .finally(() => parser.free());
  });

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isLiteParseWorkerRequest(request)) {
    globalThis.postMessage({ kind: "failure" }, {});
    return;
  }

  void parseLiteParseRequest(request).then(
    (result) => {
      if (
        hasBoundedPdfLiteParseResult(result, request.pageCount) &&
        Schema.is(PdfLiteParseResultSchemaForPageCount(request.pageCount))(result)
      ) {
        globalThis.postMessage({ kind: "success", result }, {});
        return;
      }
      globalThis.postMessage({ kind: "failure" }, {});
    },
    () => {
      globalThis.postMessage({ kind: "failure" }, {});
    },
  );
});
