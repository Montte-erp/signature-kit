import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultTreeAdapter, parse } from "parse5";
import { fromXml } from "xast-util-from-xml";

import { Config, Duration, Effect, Fiber, Layer, Option, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Http from "foldkit/http";
import * as FoldkitNode from "@foldkit/node";
import { FoldkitBuildManifest } from "@foldkit/vite-plugin";
import { localHttpServer } from "../../../tooling/testing/local-http.ts";
import { describe, expect, it } from "vitest";

import { buildContentSite } from "../scripts/build-content-site";
import { socialImagesLayer } from "../src/content/social.ts";
import { contentHighlighterLayer } from "../src/content/highlight";

describe("Foldkit site publication", () => {
  it("builds localized documents and a browser entry from the real content collection", async ({
    signal,
  }) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const buildRoot = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "signature-kit-site-"))),
            (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
          );
          const outputDir = join(buildRoot, "client");
          yield* Effect.promise(() => mkdir(outputDir));
          yield* Effect.promise(() => writeFile(join(outputDir, "obsolete.html"), "old build"));
          const metadata = yield* buildContentSite({
            outputDir: buildRoot,
            siteUrl: "https://signaturekit.dev",
          });
          expect(metadata.clientDirectory).toBe(outputDir);
          const outputs = yield* Effect.promise(() => readdir(outputDir));
          expect(outputs).not.toContain("obsolete.html");
          expect(outputs.filter((name) => name.endsWith(".js") || name.endsWith(".mjs"))).toEqual(
            [],
          );
          const home = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/index.html"), "utf8"),
          );
          expect(home).toContain("Um ponto único de assinatura tipado");
          expect(home).toContain('href="/pt-BR/docs/get-started/quickstart"');
          expect(home).toContain('id="home-provider-clicksign"');
          expect(home).toContain("AssinafySignatureRequest");
          const freeSigning = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/assine-documentos-gratis/index.html"), "utf8"),
          );
          expect(freeSigning).toContain("Assine documentos grátis com A1 no navegador.");
          expect(freeSigning).toContain(
            'rel="canonical" href="https://signaturekit.dev/pt-BR/assine-documentos-gratis"',
          );
          expect(freeSigning).toContain('type="application/ld+json"');
          expect(freeSigning).toContain('"@type":"SoftwareApplication"');
          expect(freeSigning).toContain('"@type":"HowTo"');
          expect(freeSigning).toContain('"@type":"FAQPage"');
          expect(freeSigning).not.toContain('hreflang="en-US"');
          const englishOutputs = yield* Effect.promise(() => readdir(join(outputDir, "en-US")));
          expect(englishOutputs).not.toContain("assine-documentos-gratis");
          const document = parse(home);
          const html = document.childNodes.find(
            (node) => defaultTreeAdapter.isElementNode(node) && node.tagName === "html",
          );
          if (html === undefined || !defaultTreeAdapter.isElementNode(html))
            return yield* Effect.die("Published HTML requires a root");
          const elements = html.childNodes
            .filter((node) => defaultTreeAdapter.isElementNode(node))
            .flatMap((node) => node.childNodes)
            .filter((node) => defaultTreeAdapter.isElementNode(node));
          const stylesheet = elements
            .find(
              (node) =>
                node.tagName === "link" &&
                node.attrs.some(
                  (attribute) => attribute.name === "rel" && attribute.value === "stylesheet",
                ),
            )
            ?.attrs.find((attribute) => attribute.name === "href")?.value;
          const entry = elements
            .find(
              (node) =>
                node.tagName === "script" &&
                node.attrs.some(
                  (attribute) => attribute.name === "type" && attribute.value === "module",
                ),
            )
            ?.attrs.find((attribute) => attribute.name === "src")?.value;
          if (stylesheet === undefined || entry === undefined)
            return yield* Effect.die("Published HTML requires emitted script and stylesheet links");
          const css = yield* Effect.promise(() => readFile(join(outputDir, stylesheet), "utf8"));
          expect(css.length).toBeGreaterThan(0);
          const english = yield* Effect.promise(() =>
            readFile(join(outputDir, "en-US/docs/get-started/installation/index.html"), "utf8"),
          );
          const portuguese = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/docs/get-started/installation/index.html"), "utf8"),
          );
          const release = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/changelog/native-cms-buffers/index.html"), "utf8"),
          );
          const blogIndex = yield* Effect.promise(() =>
            readFile(join(outputDir, "en-US/blog/index.html"), "utf8"),
          );
          const tagIndex = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/blog/tags/index.html"), "utf8"),
          );
          expect(tagIndex).toContain("Tags do blog");
          const releaseIndex = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/changelog/index.html"), "utf8"),
          );
          expect(blogIndex).toContain('href="/en-US/blog/signature-kit-x-licitei"');
          expect(blogIndex).toContain('property="og:type" content="website"');
          expect(releaseIndex).toContain('property="og:type" content="website"');
          expect(releaseIndex).toContain('href="/pt-BR/changelog/native-cms-buffers"');
          const sitemap = yield* Effect.promise(() =>
            readFile(join(outputDir, "sitemap.xml"), "utf8"),
          );
          expect(sitemap).toContain("https://signaturekit.dev/pt-BR/docs/signing/certificates");
          expect(sitemap).toContain("https://signaturekit.dev/pt-BR/assine-documentos-gratis");
          expect(sitemap).toContain('hreflang="en-US"');
          expect(
            fromXml(sitemap).children.some(
              (node) => node.type === "element" && node.name === "urlset",
            ),
          ).toBe(true);
          const feed = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/blog/rss.xml"), "utf8"),
          );
          const globalFeed = yield* Effect.promise(() =>
            readFile(join(outputDir, "rss.xml"), "utf8"),
          );
          expect(feed).toContain("Blog do SignatureKit");
          expect(feed).toContain("Fri, 26 Jun 2026 00:00:00 GMT");
          expect(
            fromXml(feed).children.some((node) => node.type === "element" && node.name === "rss"),
          ).toBe(true);
          expect(globalFeed).toContain("/en-US/changelog/native-cms-buffers");
          expect(globalFeed).not.toContain("/pt-BR/changelog/native-cms-buffers");
          const markdown = yield* Effect.promise(() =>
            readFile(join(outputDir, "en-US/docs/get-started/installation.md"), "utf8"),
          );
          const robots = yield* Effect.promise(() =>
            readFile(join(outputDir, "robots.txt"), "utf8"),
          );
          const llms = yield* Effect.promise(() => readFile(join(outputDir, "llms.txt"), "utf8"));
          const fullText = yield* Effect.promise(() =>
            readFile(join(outputDir, "llms-full.txt"), "utf8"),
          );
          const registry = yield* Effect.promise(() =>
            readFile(join(outputDir, "r/registry.json"), "utf8"),
          );
          expect(markdown).toContain("# Installation (/en-US/docs/get-started/installation)");
          expect(markdown).toContain("a1SignaturesLayer");
          expect(markdown).not.toContain("title: Installation");
          expect(robots).toContain("Sitemap: https://signaturekit.dev/sitemap.xml");
          expect(llms).toContain("/pt-BR/docs/signing/certificates");
          expect(fullText).toContain("signatures.inspect()");
          expect(registry).toContain("https://ui.shadcn.com/schema/registry.json");
          const search = yield* Effect.promise(() =>
            readFile(join(outputDir, "pt-BR/search.json"), "utf8"),
          );
          expect(search).toContain('"path":"docs/signing/certificates"');
          expect(search).toContain("signatures.inspect()");
          const script = yield* Effect.promise(() => readFile(join(outputDir, entry), "utf8"));

          expect(english).toContain("Install the packages");
          expect(english).toContain(
            '<meta name="description" content="Install the core and the A1 signer, provide the Signatures layer, and sign your first bytes with typed errors.">',
          );
          expect(english).toContain(
            'hreflang="pt-BR" href="https://signaturekit.dev/pt-BR/docs/get-started/installation"',
          );
          expect(english).toContain('property="og:title"');
          expect(english).toContain(
            'property="og:image" content="https://signaturekit.dev/en-US/docs/get-started/installation.webp"',
          );
          const image = yield* Effect.promise(() =>
            readFile(join(outputDir, "en-US/docs/get-started/installation.webp")),
          );
          expect(image.toString("ascii", 0, 4)).toBe("RIFF");
          expect(image.toString("ascii", 8, 12)).toBe("WEBP");
          expect(english).toContain('aria-label="Select language"');
          const certificates = yield* Effect.promise(() =>
            readFile(join(outputDir, "en-US/docs/signing/certificates/index.html"), "utf8"),
          );
          expect(certificates).toContain('aria-label="On this page"');
          expect(certificates).toContain('href="#read-the-identity"');
          expect(english).toContain("data-foldkit-app");
          expect(english).toContain(`src="${entry}"`);
          expect(portuguese).toContain('<html lang="pt-BR"');
          expect(portuguese).toContain("Instale os pacotes");
          expect(english).toContain('aria-label="Documentation navigation"');
          expect(portuguese).toContain("Comece aqui");
          expect(english).toContain('href="/en-US/docs/providers/clicksign"');
          expect(release).toContain("Native byte conversion and verified release gates");
          expect(script.length).toBeGreaterThan(0);
          const appRoot = fileURLToPath(new URL("../", import.meta.url));
          const manifestPath = join(buildRoot, "server/foldkit.build.json");
          const manifest = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(FoldkitBuildManifest),
          )(yield* Effect.promise(() => readFile(manifestPath, "utf8")));
          const clientRoot = resolve(appRoot, manifest.client);
          expect(clientRoot).toBe(join(buildRoot, "client"));
          expect(resolve(appRoot, manifest.server)).toBe(join(buildRoot, "server"));
          const serverEntry = yield* Effect.promise(() =>
            readFile(join(buildRoot, "server", manifest.serverEntry), "utf8"),
          );
          expect(serverEntry.length).toBeGreaterThan(0);
          yield* Effect.promise(() =>
            rm(join(clientRoot, "en-US/docs/get-started/installation/index.html")),
          );
          const origin = yield* Effect.scoped(
            localHttpServer(async () => ({ status: 204 })).pipe(
              Effect.map((server) => server.baseUrl),
            ),
          );
          const port = yield* Schema.decodeUnknownEffect(Schema.FiniteFromString)(
            new URL(origin).port,
          );
          const host = yield* Effect.forkScoped(
            FoldkitNode.serve({
              port: Config.succeed(port),
              origin: Config.succeed(Option.some(origin)),
              manifestPath,
              rootDirectory: appRoot,
            }),
          );
          const ready = yield* Effect.raceFirst(
            Fiber.join(host),
            Effect.scoped(
              Effect.gen(function* () {
                const response = yield* HttpClient.get(origin + "/r/registry.json");
                const body = yield* response.text;
                return { status: response.status, body };
              }),
            ).pipe(
              Effect.timeout(Duration.millis(500)),
              Effect.retry({
                schedule: Schedule.spaced(Duration.millis(100)),
                while: (issue) =>
                  issue._tag === "TimeoutError" || issue.reason._tag === "TransportError",
              }),
              Effect.timeoutOrElse({
                duration: Duration.seconds(10),
                orElse: () => Effect.die("Native host readiness did not complete"),
              }),
            ),
          );
          expect(ready.status).toBe(200);
          expect(ready.body).toContain("https://ui.shadcn.com/schema/registry.json");
          yield* Effect.gen(function* () {
            const response = yield* HttpClient.get(origin + "/en-US");
            expect(response.status).toBe(200);
            expect(yield* response.text).toContain("SignatureKit");
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(10),
              orElse: () => Effect.die("Native home GET did not complete"),
            }),
          );
          yield* Effect.gen(function* () {
            const response = yield* HttpClient.head(origin + "/en-US");
            expect(response.status).toBe(200);
            expect(yield* response.text).toBe("");
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(10),
              orElse: () => Effect.die("Native home HEAD did not complete"),
            }),
          );
          yield* Effect.gen(function* () {
            const rendered = yield* HttpClient.get(origin + "/en-US/docs/get-started/installation");
            expect(rendered.status).toBe(200);
            expect(yield* rendered.text).toContain("Install the packages");
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(10),
              orElse: () => Effect.die("Native request-time SSR did not complete"),
            }),
          );
          const missing = yield* HttpClient.get(origin + "/server/fetch.js");
          expect(missing.status).toBe(404);
          yield* missing.text;
          const refused = yield* HttpClient.post(origin + "/pt-BR/docs/get-started/installation");
          expect(refused.status).toBe(405);
          expect(refused.headers.allow).toContain("GET");
          yield* refused.text;
          yield* Effect.gen(function* () {
            const feedbackRequest = yield* HttpClientRequest.bodyJson(
              HttpClientRequest.post(origin + "/api/feedback/page"),
              {
                route: "/en-US/docs/get-started/installation",
                opinion: "good",
                message: "The installation instructions are clear.",
              },
            );
            const feedback = yield* HttpClient.execute(feedbackRequest);
            expect(feedback.status).toBe(503);
            expect(yield* feedback.json).toMatchObject({ code: "unavailable" });
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(10),
              orElse: () => Effect.die("Native feedback API did not complete"),
            }),
          );
        }),
      ).pipe(
        Effect.provide(Layer.mergeAll(contentHighlighterLayer, socialImagesLayer, Http.layer)),
      ),
      { signal },
    );
  }, 90000);
});
