import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultTreeAdapter, parse, serialize } from "parse5";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import sirv from "sirv";
import type { Plugin } from "vite";

import { locales } from "../paraglide/runtime.js";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDir = join(appRoot, ".cache/foldkit-browser-tests");

export const contentTestServer: Plugin = {
  name: "signature-kit:content-test-server",
  async configureServer(server) {
    await promisify(execFile)(
      "bunx",
      ["bun@1.4.3", join(appRoot, "scripts/build-content-site.ts"), outputDir],
      { cwd: appRoot },
    );
    const serve = sirv(join(outputDir, "client"), { dev: true });
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?")[0];
      if (pathname === undefined) return next();
      const isSitePath =
        pathname.startsWith("/assets/") ||
        locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
      if (isSitePath && request.url?.includes("__foldkit_test_defer_entry=1") === true) {
        void Effect.runPromise(
          Effect.gen(function* () {
            const source = yield* Effect.promise(() =>
              readFile(join(outputDir, "client", pathname, "index.html"), "utf8"),
            );
            const document = parse(source);
            const html = document.childNodes.find(
              (node) => defaultTreeAdapter.isElementNode(node) && node.tagName === "html",
            );
            if (html === undefined || !defaultTreeAdapter.isElementNode(html))
              return yield* Effect.die("A production document requires an html element");
            const body = html.childNodes.find(
              (node) => defaultTreeAdapter.isElementNode(node) && node.tagName === "body",
            );
            if (body === undefined || !defaultTreeAdapter.isElementNode(body))
              return yield* Effect.die("A production document requires a body");
            const entries = body.childNodes.filter(
              (node) =>
                defaultTreeAdapter.isElementNode(node) &&
                node.tagName === "script" &&
                node.attrs.some(
                  (attribute) => attribute.name === "type" && attribute.value === "module",
                ),
            );
            entries.forEach((entry) => defaultTreeAdapter.detachNode(entry));
            return serialize(document);
          }),
        ).then((body) => {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(body);
        }, next);
        return;
      }
      return isSitePath ? serve(request, response, next) : next();
    });
  },
};
