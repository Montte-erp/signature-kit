import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromXml } from "xast-util-from-xml";

import { Effect, Layer } from "effect";
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
          const outputDir = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "signature-kit-site-"))),
            (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
          );
          yield* Effect.promise(() => writeFile(join(outputDir, "obsolete.html"), "old build"));
          yield* buildContentSite({ outputDir, siteUrl: "https://signaturekit.dev" });
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
          const css = yield* Effect.promise(() =>
            readFile(join(outputDir, "assets/content.css"), "utf8"),
          );
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
          const script = yield* Effect.promise(() =>
            readFile(join(outputDir, "assets/content.js"), "utf8"),
          );

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
          expect(english).toContain('src="/assets/content.js"');
          expect(portuguese).toContain('<html lang="pt-BR"');
          expect(portuguese).toContain("Instale os pacotes");
          expect(english).toContain('aria-label="Documentation navigation"');
          expect(portuguese).toContain("Comece aqui");
          expect(english).toContain('href="/en-US/docs/providers/clicksign"');
          expect(release).toContain("Native byte conversion and verified release gates");
          expect(script.length).toBeGreaterThan(0);
        }),
      ).pipe(Effect.provide(Layer.merge(contentHighlighterLayer, socialImagesLayer))),
      { signal },
    );
  }, 90000);
});
