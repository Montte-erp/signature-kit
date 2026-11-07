import { createServer } from "vite";
import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { defineBrowserCommand } from "@vitest/browser-playwright";
import * as Server from "foldkit/experimental/server";
import type { renderDocument, renderPage } from "./entry.server";

const homeDeniedClipboard = defineBrowserCommand(async ({ context, page }) => {
  const browser = context.browser();
  if (browser === null) return { permission: "unavailable", status: null };
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const isolated = yield* Effect.acquireRelease(
          Effect.promise(() => browser.newContext()),
          (resource) => Effect.promise(() => resource.close()),
        );
        const origin = new URL(page.url()).origin;
        yield* Effect.promise(() => isolated.grantPermissions([], { origin }));
        const tab = yield* Effect.promise(() => isolated.newPage());
        yield* Effect.promise(() => tab.goto(`${origin}/en-US`));
        yield* Effect.promise(() =>
          tab.getByRole("button", { name: "Assinafy", exact: true }).click(),
        );
        yield* Effect.promise(() =>
          tab.waitForFunction(() => {
            const ready =
              document
                .querySelector(".home-code")
                ?.textContent?.includes("AssinafySignatureRequest") === true;
            if (!ready)
              [...document.querySelectorAll<HTMLButtonElement>(".home-providers button")]
                .find((button) => button.textContent === "Assinafy")
                ?.click();
            return ready;
          }),
        );
        const permission = yield* Effect.promise(() =>
          tab.evaluate(() =>
            navigator.clipboard.writeText("signaturekit clipboard probe").then(
              () => "granted",
              () => "denied",
            ),
          ),
        );
        yield* Effect.promise(() => tab.locator(".home-code .home-copy").click());
        yield* Effect.promise(() =>
          tab.getByRole("status").filter({ hasText: "Could not copy." }).waitFor(),
        );
        yield* Effect.promise(() =>
          tab.waitForFunction(
            async () =>
              (await (await fetch("/__home_analytics__/events")).text()).includes(
                "provider_snippet_copy_failed",
              ),
            undefined,
            { timeout: 20000 },
          ),
        );
        const status = yield* Effect.promise(() => tab.locator(".home-status").textContent());
        return { permission, status };
      }),
    ),
  );
});

export const homeBrowserServer = (): Plugin => ({
  name: "home-browser-test-server",
  config: () => ({
    test: { browser: { commands: { homeDeniedClipboard } } },
    define: {
      "import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN": JSON.stringify("local-home-test-token"),
      "import.meta.env.WAKU_PUBLIC_POSTHOG_HOST":
        '(typeof window === "undefined" ? "http://localhost/__home_analytics__" : window.location.origin + "/__home_analytics__")',
    },
  }),
  configureServer(server) {
    const received: string[] = [];
    server.middlewares.use("/__home_analytics__", (request, response) => {
      if (request.url === "/events") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(received));
        return;
      }
      if (request.url === "/reset") {
        received.length = 0;
        response.writeHead(204).end();
        return;
      }
      const chunks: Uint8Array[] = [];
      request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        const decoded =
          body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body).toString() : body.toString();
        const encoded = new URLSearchParams(decoded).get("data");
        received.push(encoded === null ? decoded : Buffer.from(encoded, "base64").toString());
        response.setHeader("content-type", "application/json");
        response.end("{}");
      });
    });
    const runtime = createServer({
      configFile: false,
      root: fileURLToPath(new URL("..", import.meta.url)),
      appType: "custom",
      logLevel: "error",
      server: { middlewareMode: true, hmr: false },
    });
    server.httpServer?.once("close", () => {
      void runtime.then((instance) => instance.close());
    });
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!/^\/(en-US|pt-BR)(?:\/|$)/.test(url.pathname)) return next();
      const abort = new AbortController();
      const close = () => abort.abort();
      response.once("close", close);
      const handle = async () => {
        const entry = await (await runtime).ssrLoadModule("/foldkit/entry.server.ts");
        const render: typeof renderPage = entry.renderPage;
        const document: typeof renderDocument = entry.renderDocument;
        const result = await Server.handleRequest(
          new Request(url, { method: request.method, signal: abort.signal }),
          {
            renderPage: (input) => render(input, "home-http-test"),
            renderDocument: (application) =>
              document(application, {
                entryScript: "/apps/docs/foldkit/home-http-client.ts",
                stylesheets: [],
                modulePreloads: [],
              }),
          },
        );
        const body = await result.arrayBuffer();
        response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
        response.end(Buffer.from(body));
      };
      handle()
        .catch(next)
        .finally(() => response.removeListener("close", close));
    });
  },
});
