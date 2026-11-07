import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { createServer as createViteServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import type { feedbackResponse } from "./feedback-server.ts";
import type { ServerAnalytics, serverAnalyticsLayer } from "../lib/posthog/server.ts";

export const feedbackBrowserServer = (docsRoot: string): Plugin => ({
  name: "feedback-browser-test-server",
  configureServer(vite) {
    const events: string[] = [];
    let privacyEvents: string[] | undefined;
    let privacyDiagnostics: {
      flags: boolean;
      compressed: boolean;
      formData: boolean;
      seed: boolean;
    }[] = [];
    let rejectDelivery = false;
    let disconnect = false;
    let receiver: ReturnType<typeof createServer> | undefined;
    let runtime: ViteDevServer | undefined;
    const stop = async () => {
      const current = receiver;
      const currentRuntime = runtime;
      receiver = undefined;
      runtime = undefined;
      await Promise.all([
        current === undefined
          ? Promise.resolve()
          : new Promise<void>((resolve) => current.close(() => resolve())),
        currentRuntime === undefined ? Promise.resolve() : currentRuntime.close(),
      ]);
    };
    vite.httpServer?.once("close", () => {
      void stop();
    });
    vite.middlewares.use("/__feedback_test__", (request, response, next) => {
      const path = request.url ?? "";
      if (path === "/privacy-start") {
        privacyEvents = [];
        privacyDiagnostics = [];
        response.writeHead(204).end();
        return;
      }
      if (path === "/privacy-stop") {
        privacyEvents = undefined;
        response.writeHead(204).end();
        return;
      }
      if (path === "/privacy-diagnostics") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(privacyDiagnostics));
        return;
      }
      if (path === "/privacy-events") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(privacyEvents ?? []));
        return;
      }
      if (path === "/privacy-reset") {
        if (privacyEvents !== undefined) privacyEvents.length = 0;
        response.writeHead(204).end();
        return;
      }
      if (path.startsWith("/privacy-ingest")) {
        const chunks: Uint8Array[] = [];
        request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        request.on("end", () => {
          const bytes = Buffer.concat(chunks);
          const body = (
            request.headers["content-encoding"] === "gzip" ||
            (bytes[0] === 0x1f && bytes[1] === 0x8b)
              ? gunzipSync(bytes)
              : bytes
          ).toString();
          const encoded = new URLSearchParams(body).get("data");
          const decodedBytes = encoded === null ? undefined : Buffer.from(encoded, "base64");
          const decoded =
            decodedBytes === undefined
              ? body
              : (decodedBytes[0] === 0x1f && decodedBytes[1] === 0x8b
                  ? gunzipSync(decodedBytes)
                  : decodedBytes
                ).toString();
          privacyEvents?.push(decoded);
          privacyDiagnostics.push({
            flags: path.includes("/flags"),
            compressed:
              request.headers["content-encoding"] === "gzip" ||
              (bytes[0] === 0x1f && bytes[1] === 0x8b),
            formData: encoded !== null,
            seed: decoded.includes("privacy_legacy_seed"),
          });
          response.setHeader("content-type", "application/json");
          response.end("{}");
        });
        return;
      }

      if (path.startsWith("/privacy-prelude")) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          '<!doctype html><html><body><a href="/__feedback_test__/privacy-source?source=PUBLIC_QUERY_SENTINEL&amp;q=PUBLIC_QUERY_SENTINEL&amp;utm_campaign=PUBLIC_QUERY_SENTINEL&amp;gclid=PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL">continue</a></body></html>',
        );
        return;
      }
      if (path.startsWith("/privacy-source")) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          '<!doctype html><html><body><a href="/__feedback_test__/privacy-target?utm_source=PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL">continue</a><script type="module" src="/apps/docs/foldkit/posthog-privacy-source.browser.ts"></script></body></html>',
        );
        return;
      }
      if (path.startsWith("/privacy-target")) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          '<!doctype html><html><body><script type="module" src="/apps/docs/foldkit/posthog-privacy-target.browser.ts"></script></body></html>',
        );
        return;
      }
      if (path === "/bfcache") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          '<!doctype html><html><body><div id="app"></div><script type="module" src="/apps/docs/foldkit/feedback-bfcache.browser.ts"></script></body></html>',
        );
        return;
      }
      if (path === "/away") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><html><body>away</body></html>");
        return;
      }

      if (path === "/start") {
        events.length = 0;
        rejectDelivery = false;
        disconnect = false;
        const current = createServer((incoming, outgoing) => {
          const chunks: Uint8Array[] = [];
          incoming.on("data", (chunk: Uint8Array) => chunks.push(chunk));
          incoming.on("end", () => {
            const bytes = Buffer.concat(chunks);
            events.push(
              (incoming.headers["content-encoding"] === "gzip"
                ? gunzipSync(bytes)
                : bytes
              ).toString(),
            );
            outgoing.writeHead(rejectDelivery ? 400 : 200).end("{}");
          });
        });
        void stop()
          .then(() =>
            createViteServer({
              configFile: false,
              root: docsRoot,
              appType: "custom",
              logLevel: "error",
              resolve: { alias: { "@": docsRoot } },
              server: { middlewareMode: true, hmr: false },
            }),
          )
          .then((server) => {
            runtime = server;
            receiver = current;
            current.once("error", (error) => {
              void stop().then(() => next(error));
            });
            current.listen(0, "127.0.0.1", () => response.writeHead(204).end());
          }, next);
        return;
      }
      if (path === "/stop") {
        void stop().then(() => response.writeHead(204).end());
        return;
      }
      if (path === "/events") {
        response.writeHead(200).end(events.join("\n"));
        return;
      }
      if (path === "/reject") {
        rejectDelivery = true;
        response.writeHead(204).end();
        return;
      }
      if (path === "/offline") {
        disconnect = true;
        response.writeHead(204).end();
        return;
      }
      if (disconnect) {
        request.socket.destroy();
        return;
      }
      const address = receiver?.address();
      const activeRuntime = runtime;
      if (
        address === null ||
        address === undefined ||
        typeof address === "string" ||
        activeRuntime === undefined
      ) {
        response.writeHead(503).end();
        return;
      }
      const chunks: Uint8Array[] = [];
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      request.on("end", () => {
        void Promise.all([
          activeRuntime.ssrLoadModule("/foldkit/feedback-server.ts"),
          activeRuntime.ssrLoadModule("/lib/posthog/server.ts"),
        ])
          .then(([feedback, analytics]) => {
            const respond: typeof feedbackResponse = feedback.feedbackResponse;
            const Analytics: typeof ServerAnalytics = analytics.ServerAnalytics;
            const layer: typeof serverAnalyticsLayer = analytics.serverAnalyticsLayer;
            return Effect.runPromise(
              Effect.gen(function* () {
                const service = yield* Analytics;
                return yield* respond(
                  new Request(`http://localhost${path}`, {
                    method: request.method,
                    headers: { "content-type": request.headers["content-type"] ?? "" },
                    body: Buffer.concat(chunks),
                  }),
                  service,
                );
              }).pipe(
                Effect.provide(
                  layer({
                    token: "local-test-token",
                    host: `http://127.0.0.1:${address.port}`,
                  }),
                ),
                Effect.orDie,
              ),
            );
          })
          .then((result) => response.writeHead(result?.status ?? 404).end(), next);
      });
    });
  },
});
