import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultTreeAdapter, parse, serialize } from "parse5";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Exit, Scope } from "effect";
import * as Http from "foldkit/http";
import { contentTestHost } from "./content-test-host.ts";
import type { Plugin } from "vite";

import { locales } from "../paraglide/runtime.js";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDir = join(appRoot, ".cache/foldkit-browser-tests");

export const contentTestServer = (): Plugin => {
  const scope = Scope.makeUnsafe();
  return {
    name: "signature-kit:content-test-server",
    async configureServer(server) {
      await promisify(execFile)(
        "bunx",
        ["bun@1.4.3", join(appRoot, "scripts/build-content-site.ts"), outputDir],
        { cwd: appRoot },
      );
      const origin = await Effect.runPromise(
        contentTestHost({
          manifestPath: join(outputDir, "server/foldkit.build.json"),
          rootDirectory: appRoot,
        }).pipe(
          Scope.provide(scope),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
          Effect.provide(Http.layer),
        ),
      );
      server.config.server.proxy = {
        ...server.config.server.proxy,
        "^/(assets/|r/|api/feedback/|en-US(?:/|$)|pt-BR(?:/|$))": { target: origin },
      };
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
        return next();
      });
    },
    closeBundle: () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))),
  };
};
