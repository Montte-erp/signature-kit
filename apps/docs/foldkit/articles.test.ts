import { Popover } from "@foldkit/ui";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { DOMParser } from "@xmldom/xmldom";
import { Effect, Schema } from "effect";
import * as Server from "foldkit/experimental/server";
import { parseContent, renderContent } from "./content";
import { createView, Flags, init, Message, update } from "./main";
import type { HtmlBuilder } from "foldkit/html";
import {
  ArticleDate,
  articles,
  blogTags,
  indexArticles,
  indexTags,
  resolveArticle,
  tagSlug,
} from "./articles";
import {
  createServerComposition,
  prerenderPaths,
  renderDocument,
  renderPage,
} from "./entry.server";
import type { Locale } from "./content";

const alternateLanguages = (html: string) => {
  const document = new DOMParser({ onError: () => {} }).parseFromString(html, "text/html");
  return Array.from(document.getElementsByTagName("link")).flatMap((link) =>
    Array.from(link.attributes)
      .filter((attribute) => attribute.name.toLowerCase() === "hreflang")
      .map((attribute) => attribute.value),
  );
};

const fixtureSource = () => {
  const sources = new Map([
    [
      "blog/ação & api",
      parseContent(
        '---\ntitle: English article\ndate: 2026-01-01\ntags: ["São Paulo & 100%"]\n---\nEnglish',
      ),
    ],
    [
      "blog/ação & api.pt-BR",
      parseContent(
        '---\ntitle: Artigo português\ndate: 2026-01-02\ntags: ["São Paulo & 100%", "Só Brasil"]\n---\nPortuguês',
      ),
    ],
    [
      "blog/fallback",
      parseContent(
        '---\ntitle: Fallback English\ndate: 2026-01-03\ntags: ["English Only"]\n---\nFallback',
      ),
    ],
  ]);
  const source = {
    paths: () => [...sources.keys()],
    resolve: (locale: Locale, section: string, slug: string) =>
      sources.get(`${section}/${slug || "index"}${locale === "pt-BR" ? ".pt-BR" : ""}`),
  };
  return source;
};

describe("Foldkit articles", () => {
  it("renders fixture tags through the production server composition", async () => {
    const source = fixtureSource();
    const server = createServerComposition(source);
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    const shared = "s%C3%A3o-paulo-%26-100%25";
    const portuguese = "s%C3%B3-brasil";
    const render = async (path: string) => {
      const result = await server.renderPage(new Request(`https://example.test${path}`), "test");
      if (result._tag !== "Rendered") return expect.fail(`Missing ${path}`);
      return server.renderDocument(result.application, assets);
    };
    for (const locale of ["en-US", "pt-BR"]) {
      const index = await render(`/${locale}/blog/tags`);
      expect(index).toContain(`/${locale}/blog/tags/${shared}`);
      expect(server.prerenderPaths).toContain(`/${locale}/blog/tags/${shared}`);
      const head = await server.renderPage(
        new Request(`https://example.test/${locale}/blog/tags/${shared}`, { method: "HEAD" }),
        "test",
      );
      expect(head._tag).toBe("Rendered");
      if (head._tag === "Rendered") {
        expect(server.renderDocument(head.application, assets)).toContain(
          `rel="canonical" href="https://signaturekit.dev/${locale}/blog/tags/${shared}"`,
        );
      }
      const detail = await render(`/${locale}/blog/tags/${shared}`);
      expect(detail).toContain(locale === "pt-BR" ? "Artigo português" : "English article");
      expect(detail).toContain(`/${locale}/blog/a%C3%A7%C3%A3o%20%26%20api`);
      expect(detail).toContain(
        `rel="canonical" href="https://signaturekit.dev/${locale}/blog/tags/${shared}"`,
      );
      expect(alternateLanguages(detail)).toEqual(["en-US", "pt-BR", "x-default"]);
      expect(detail).not.toContain('name="robots"');
    }
    const ptOnly = await render(`/pt-BR/blog/tags/${portuguese}`);
    expect(alternateLanguages(ptOnly)).toEqual(["pt-BR", "x-default"]);
    expect(server.prerenderPaths).not.toContain(`/en-US/blog/tags/${portuguese}`);
    const missing = await server.renderPage(
      new Request(`https://example.test/en-US/blog/tags/${portuguese}`),
      "test",
    );
    expect(missing._tag).toBe("Responded");
    if (missing._tag === "Responded") expect(missing.response.status).toBe(404);
    const fallback = await render("/pt-BR/blog/fallback");
    expect(fallback).toContain(
      'rel="canonical" href="https://signaturekit.dev/en-US/blog/fallback"',
    );
    expect(fallback).toContain('name="robots" content="noindex"');
    expect(alternateLanguages(fallback)).toEqual(["en-US", "x-default"]);
    expect(await render("/pt-BR/blog/tags")).not.toContain("English Only");
    const sitemapHead = await server.renderPage(
      new Request("https://example.test/sitemap.xml", { method: "HEAD" }),
      "test",
    );
    expect(sitemapHead._tag).toBe("Responded");
    if (sitemapHead._tag === "Responded") {
      expect(sitemapHead.response.status).toBe(200);
      expect(await sitemapHead.response.text()).toBe("");
    }
    const sitemap = await server.renderPage(
      new Request("https://example.test/sitemap.xml"),
      "test",
    );
    if (sitemap._tag !== "Responded") return expect.fail("Missing sitemap");
    const xml = new DOMParser().parseFromString(await sitemap.response.text(), "application/xml");
    const urls = Array.from(xml.getElementsByTagName("url"));
    const tagUrls = urls.filter((item) =>
      item.getElementsByTagName("loc")[0]?.textContent?.includes("/blog/tags/"),
    );
    expect(tagUrls.map((item) => item.getElementsByTagName("loc")[0]?.textContent)).toEqual([
      "https://signaturekit.dev/en-US/blog/tags/english-only",
      `https://signaturekit.dev/en-US/blog/tags/${shared}`,
      `https://signaturekit.dev/pt-BR/blog/tags/${shared}`,
      `https://signaturekit.dev/pt-BR/blog/tags/${portuguese}`,
    ]);
    expect(
      Array.from(tagUrls[1]?.getElementsByTagName("xhtml:link") ?? []).map((link) =>
        link.getAttribute("hreflang"),
      ),
    ).toEqual(["en-US", "pt-BR"]);
    expect(
      Array.from(tagUrls[3]?.getElementsByTagName("xhtml:link") ?? []).map((link) =>
        link.getAttribute("hreflang"),
      ),
    ).toEqual(["pt-BR"]);
  });
  it("routes the language menu to available tags while preserving other destinations", async () => {
    const source = fixtureSource();
    const server = createServerComposition(source);
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    const portuguese = "s%C3%B3-brasil";
    const shared = "s%C3%A3o-paulo-%26-100%25";
    const menu = async (locale: Locale, path: string, query = "") => {
      const application = await Effect.runPromise(
        Server.renderToString(
          {
            Flags,
            init: (flags: typeof Flags.Type) => ({
              model: update(
                init(flags).model,
                Message.GotLanguagePopoverMessage({ message: Popover.Message.RequestedOpen() }),
              ).model,
            }),
            view: createView(source),
          },
          { flags: { locale, path, query }, buildId: "test" },
        ),
      );
      return server.renderDocument(application, assets);
    };
    const ptMenu = await menu("pt-BR", `/blog/tags/${portuguese}`);
    expect(ptMenu).toContain('href="/en-US/blog/tags"');
    expect(ptMenu).toContain(`href="/pt-BR/blog/tags/${portuguese}"`);
    const sharedMenu = await menu("pt-BR", `/blog/tags/${shared}`);
    expect(sharedMenu).toContain(`href="/en-US/blog/tags/${shared}"`);
    const searchMenu = await menu("pt-BR", "/search", "ação & api");
    expect(searchMenu).toContain('href="/en-US/search?q=a%C3%A7%C3%A3o+%26+api"');
    const signingMenu = await menu("pt-BR", "/assine-documentos-gratis");
    expect(signingMenu).toContain('href="/en-US/sign-free"');
  });
  it("serves fixture canonical images and page HEAD over HTTP", async () => {
    const app = createServerComposition(fixtureSource());
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const failures: unknown[] = [];
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              createServer((request, reply) => {
                const handle = async () => {
                  const webRequest = new Request(`http://localhost${request.url ?? "/"}`, {
                    method: request.method,
                  });
                  const response = new URL(webRequest.url).pathname.endsWith(".webp")
                    ? Server.toResponse(
                        (application) => app.renderDocument(application, assets),
                        await app.renderPage(webRequest, "test"),
                      )
                    : await Server.handleRequest(webRequest, {
                        renderPage: (input) => app.renderPage(input, "test"),
                        renderDocument: (application) => app.renderDocument(application, assets),
                      });
                  reply.writeHead(response.status, Object.fromEntries(response.headers.entries()));
                  reply.end(Buffer.from(await response.arrayBuffer()));
                };
                handle().catch((error: unknown) => {
                  failures.push(error);
                  reply.writeHead(500).end();
                });
              }),
            ),
            (server) =>
              Effect.promise(
                () =>
                  new Promise<void>((resolve, reject) => {
                    server.closeAllConnections();
                    server.close((error) => (error !== undefined ? reject(error) : resolve()));
                  }),
              ).pipe(Effect.timeout("3 seconds"), Effect.orDie),
          );
          server.listen(0, "127.0.0.1");
          yield* Effect.promise(() => once(server, "listening"));
          const address = server.address();
          if (address === null || typeof address === "string")
            return expect.fail("Missing server address");
          yield* Effect.promise(async (signal) => {
            const base = `http://127.0.0.1:${address.port}`;
            for (const [page, image] of [
              ["/pt-BR/blog/fallback", "/en-US/blog/fallback.webp"],
              [
                "/pt-BR/blog/a%C3%A7%C3%A3o%20%26%20api",
                "/pt-BR/blog/a%C3%A7%C3%A3o%20%26%20api.webp",
              ],
              [
                "/pt-BR/blog/tags/s%C3%A3o-paulo-%26-100%25",
                "/pt-BR/blog/tags/s%C3%A3o-paulo-%26-100%25.webp",
              ],
            ]) {
              const pageResponse = await fetch(`${base}${page}`, { signal });
              if (pageResponse.status !== 200)
                return expect.fail(`Page failed: ${String(failures[0])}`);
              expect(await pageResponse.text()).toContain(
                `property="og:image" content="https://signaturekit.dev${image}"`,
              );
              const head = await fetch(`${base}${page}`, { method: "HEAD", signal });
              expect(head.status).toBe(200);
              expect(await head.text()).toBe("");
              const imageResponse = await fetch(`${base}${image}`, { signal });
              if (imageResponse.status !== 200)
                return expect.fail(`Image failed: ${String(failures[0])}`);
              expect(imageResponse.headers.get("content-type")).toBe("image/webp");
              const bytes = new Uint8Array(await imageResponse.arrayBuffer());
              expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
              expect(new TextDecoder().decode(bytes.subarray(8, 16))).toBe("WEBPVP8L");
              const size = new DataView(bytes.buffer).getUint32(21, true);
              expect([(size & 0x3fff) + 1, ((size >>> 14) & 0x3fff) + 1]).toEqual([1200, 630]);
            }
          });
        }),
      ).pipe(Effect.timeout("30 seconds")),
    );
  }, 35000);
  it("groups parsed localized articles without indexing fallback tags", () => {
    const english = parseContent(
      '---\ntitle: English\ndate: 2026-01-01\ntags: ["São Paulo & Effect", TypeScript]\n---\n',
    );
    const portuguese = parseContent(
      '---\ntitle: Português\ndate: 2026-01-02\ntags: ["São Paulo & Effect"]\n---\n',
    );
    const fallback = parseContent(
      "---\ntitle: Fallback\ndate: 2026-01-03\ntags: [EnglishOnly]\n---\n",
    );
    const instant = (content: typeof english) => {
      const date = Effect.runSync(Schema.decodeUnknownEffect(ArticleDate)(content)).date;
      return { ...content, date: date.toISOString(), timestamp: date.getTime() };
    };
    const enEntries = indexArticles("en-US", "blog", [
      { slug: "ação & api", content: instant(english) },
      { slug: "fallback", content: instant(fallback) },
    ]);
    const ptEntries = indexArticles("pt-BR", "blog", [
      { slug: "ação & api", content: instant(portuguese) },
      { slug: "fallback", content: instant(fallback) },
    ]);
    const enTags = indexTags(enEntries, (slug) =>
      slug === "ação & api" ? english : slug === "fallback" ? fallback : undefined,
    );
    const ptTags = indexTags(ptEntries, (slug) => (slug === "ação & api" ? portuguese : undefined));
    expect(enTags.map(({ slug }) => slug)).toEqual([
      "englishonly",
      "são-paulo-&-effect",
      "typescript",
    ]);
    expect(ptTags.map(({ slug }) => slug)).toEqual(["são-paulo-&-effect"]);
    expect(ptTags[0]?.entries.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "Português", href: "/pt-BR/blog/a%C3%A7%C3%A3o%20%26%20api" },
    ]);
    expect(enTags.find(({ slug }) => slug === "são-paulo-&-effect")?.entries[0]?.href).toBe(
      "/en-US/blog/a%C3%A7%C3%A3o%20%26%20api",
    );
  });
  it("indexes legacy tag slugs and exposes only real localized tag routes", async () => {
    expect(
      parseContent('---\ntitle: Example\ntags: ["São Paulo & Effect", TypeScript]\n---\n').tags,
    ).toEqual(["São Paulo & Effect", "TypeScript"]);
    expect(tagSlug("São Paulo & Effect")).toBe("são-paulo-&-effect");
    for (const locale of ["en-US", "pt-BR"] satisfies ("en-US" | "pt-BR")[]) {
      const index = await renderPage(
        new Request(`https://example.test/${locale}/blog/tags`),
        "test",
      );
      expect(index._tag).toBe("Rendered");
      expect(prerenderPaths).toContain(`/${locale}/blog/tags`);
      for (const tag of blogTags(locale)) {
        const path = `/${locale}/blog/tags/${encodeURIComponent(tag.slug)}`;
        expect(prerenderPaths).toContain(path);
        expect((await renderPage(new Request(`https://example.test${path}`), "test"))._tag).toBe(
          "Rendered",
        );
      }
      const missing = await renderPage(
        new Request(`https://example.test/${locale}/blog/tags/not-a-real-tag`),
        "test",
      );
      expect(missing._tag).toBe("Responded");
      if (missing._tag === "Responded") expect(missing.response.status).toBe(404);
    }
  });

  it("indexes localized articles and falls back to English for missing translations", () => {
    expect(articles("en-US", "blog")[0]?.title).toContain("signing in the browser");
    expect(articles("pt-BR", "blog")[0]?.title).toContain("assinar com A1");
    const changelog = articles("pt-BR", "changelog");
    expect(changelog.length).toBeGreaterThan(1);
    expect(changelog.map((entry) => entry.timestamp)).toEqual(
      changelog.map((entry) => entry.timestamp).sort((a, b) => b - a),
    );
    expect(resolveArticle("pt-BR", "changelog", "a1-node-esm-release")?.title).toBe(
      "Publish A1 with Node-resolvable imports",
    );
    expect(changelog.some((entry) => entry.href === "/pt-BR/changelog/a1-node-esm-release")).toBe(
      true,
    );
    expect(prerenderPaths).toContain("/pt-BR/changelog/a1-node-esm-release");
  });

  for (const locale of ["en-US", "pt-BR"] satisfies Locale[]) {
    for (const section of ["blog", "changelog"] satisfies ("blog" | "changelog")[]) {
      it(`renders every ${locale} ${section} article and index through the server`, async () => {
        const index = await renderPage(
          new Request(`https://signaturekit.dev/${locale}/${section}`),
          "test",
        );
        expect(index._tag).toBe("Rendered");
        const indexHtml = JSON.stringify(index);
        for (const entry of articles(locale, section)) {
          expect(indexHtml).toContain(entry.title);
          expect(indexHtml).toContain(entry.href);
          const result = await renderPage(
            new Request(`https://signaturekit.dev${entry.href}`),
            "test",
          );
          expect(result._tag).toBe("Rendered");
          const html = JSON.stringify(result);
          expect(html).toContain(entry.title);
          expect(html).toContain(entry.date);
          expect(html).toContain(
            `https://signaturekit.dev/${locale === "pt-BR" && section === "changelog" ? "en-US" : locale}/${section}/${entry.slug}`,
          );
          if (locale === "pt-BR" && section === "blog" && entry.slug === "signature-kit-x-licitei")
            expect(html).toContain("/pt-BR/docs/signing/certificates");
        }
      });
    }
  }

  it("renders source canonical, noindex and actual translation alternates", async () => {
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    const fallback = await renderPage(
      new Request("https://signaturekit.dev/pt-BR/changelog/a1-node-esm-release"),
      "test",
    );
    expect(fallback._tag).toBe("Rendered");
    if (fallback._tag === "Rendered") {
      const html = renderDocument(fallback.application, assets);
      expect(html).toContain(
        'rel="canonical" href="https://signaturekit.dev/en-US/changelog/a1-node-esm-release"',
      );
      expect(html).toContain('name="robots" content="noindex"');
      expect(alternateLanguages(html)).toContain("en-US");
      expect(alternateLanguages(html)).toContain("x-default");
      expect(alternateLanguages(html)).not.toContain("pt-BR");
    }
    const translated = await renderPage(
      new Request("https://signaturekit.dev/pt-BR/blog/signature-kit-x-licitei"),
      "test",
    );
    if (translated._tag === "Rendered") {
      const html = renderDocument(translated.application, assets);
      expect(alternateLanguages(html)).toContain("pt-BR");
      expect(alternateLanguages(html)).toContain("en-US");
      expect(html).not.toContain('name="robots"');
    } else expect.fail("Expected rendered article");
  });

  it("renders social metadata and localized collection alternates with a fixed origin", async () => {
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    for (const path of [
      "/en-US/blog",
      "/pt-BR/blog/tags",
      "/en-US/sign-free",
      "/pt-BR/assine-documentos-gratis",
      "/en-US/blog/signature-kit-x-licitei",
    ]) {
      const result = await renderPage(new Request(`https://hostile.example${path}`), "test");
      if (result._tag !== "Rendered") return expect.fail(`Missing ${path}`);
      const html = renderDocument(result.application, assets);
      expect(html).toContain('name="description"');
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:url"');
      expect(html).toContain('property="og:locale"');
      expect(html).toContain('property="og:site_name"');
      expect(html).toContain('name="twitter:title"');
      expect(alternateLanguages(html)).toContain("x-default");
      expect(html).not.toContain("hostile.example");
    }
    const search = await renderPage(
      new Request("https://hostile.example/en-US/search?q=test"),
      "test",
    );
    if (search._tag !== "Rendered") return expect.fail("Missing search");
    expect(renderDocument(search.application, assets)).toContain('name="robots" content="noindex"');
    const escaped = renderDocument({ ...search.application, title: 'A & "<script>' }, assets);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("A &amp; &quot;&lt;script&gt;");
  });

  it("validates required dates and compares actual instants", () => {
    expect(Schema.decodeUnknownOption(ArticleDate)({})._tag).toBe("None");
    for (const date of ["invalid", "1", "2026-02-30"]) {
      expect(Schema.decodeUnknownOption(ArticleDate)({ date })._tag).toBe("None");
    }
    const entries = [
      { slug: "older", date: "2026-01-01T01:00:00+02:00" },
      { slug: "same-b", date: "2026-01-01T02:00:00+02:00" },
      { slug: "same-a", date: "2026-01-01T00:00:00Z" },
      { slug: "newest", date: "2026-01-01T00:30:00Z" },
    ].map(({ slug, date }) => {
      const content = parseContent(`---\ntitle: ${slug}\ndate: "${date}"\n---\n`);
      const instant = Effect.runSync(Schema.decodeUnknownEffect(ArticleDate)(content)).date;
      return { slug, content: { ...content, date, timestamp: instant.getTime() } };
    });
    const indexed = indexArticles("pt-BR", "blog", entries);
    expect(indexed.map((entry) => entry.slug)).toEqual(["newest", "same-a", "same-b", "older"]);
    expect(indexed[0]?.href).toBe("/pt-BR/blog/newest");
    expect(indexed[1]?.timestamp).toBe(indexed[2]?.timestamp);
    const first = entries[0];
    if (first === undefined) return expect.fail("Missing entry");
    expect(indexArticles("en-US", "blog", [{ ...first, slug: "ação & api" }])[0]?.href).toBe(
      "/en-US/blog/a%C3%A7%C3%A3o%20%26%20api",
    );
  });

  it("fails malformed localized metadata before an English fallback can be read", () => {
    let fallbackRead = false;
    const english = () => {
      fallbackRead = true;
      return parseContent("---\ntitle: English\ndate: 2026-01-01\n---\n");
    };
    for (const localized of ["---\ntitle: Português\ndate: 123\n---\n", "---\ntitle: [\n---\n"]) {
      expect(() => parseContent(localized) ?? english()).toThrow();
      expect(fallbackRead).toBe(false);
    }
  });

  it("preserves relative links in article content", async () => {
    const page = parseContent(
      "---\ntitle: Relative links\n---\n\n[Next](next-page) [Unsafe](javascript:alert%281%29)",
    );
    expect(page).toBeDefined();
    const view = (_model: object, h: HtmlBuilder<never>) => ({
      title: "Relative links",
      body: h.main([], renderContent(page?.nodes ?? [], h)),
    });
    const result = await Effect.runPromise(
      Server.renderToString(
        { Flags, init, view },
        { flags: { locale: "en-US", path: "/blog" }, isHydratable: false },
      ),
    );
    expect(JSON.stringify(result)).toContain('href=\\"next-page\\"');
    expect(JSON.stringify(result)).not.toContain('href=\\"javascript:');
  });

  it("rejects unknown articles and noncanonical locales", async () => {
    for (const path of [
      "/en-US/blog/missing",
      "/pt-BR/changelog/missing",
      "/pt-br/blog",
      "/en-US/blog/signature-kit-x-licitei.pt-BR",
      "/pt-BR/blog/signature-kit-x-licitei.pt-BR",
    ]) {
      const result = await renderPage(new Request(`https://signaturekit.dev${path}`), "test");
      expect(result._tag).toBe("Responded");
      if (result._tag === "Responded") expect(result.response.status).toBe(404);
    }
  });
});
