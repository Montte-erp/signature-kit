import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { signatureKitErrorCatalog } from "@signature-kit/signatures";
import * as Server from "foldkit/experimental/server";
import {
  contentPaths,
  docsNavigation,
  parseContent,
  renderContent,
  resolveContent,
} from "./content";
import type { HtmlBuilder } from "foldkit/html";
import { Flags, init, view } from "./main";
import type { Model, Message } from "./main";
import { renderPage } from "./entry.server";

describe("Foldkit content", () => {
  const render = async (source: string) => {
    const page = parseContent(source);
    const fixtureView = (_model: object, h: HtmlBuilder<never>) => ({
      title: page.title,
      body: h.main([], renderContent(page.nodes, h)),
    });
    return JSON.stringify(
      await Effect.runPromise(
        Server.renderToString<Model, never, typeof Flags.Type>(
          { Flags, init, view: fixtureView },
          { flags: { locale: "en-US", path: "/docs" }, isHydratable: false },
        ),
      ),
    );
  };
  it("passes the complete Flags contract through native server initialization", async () => {
    const result = await Effect.runPromise(
      Server.renderToString<Model, Message, typeof Flags.Type>(
        { Flags, init, view },
        { flags: { locale: "en-US", path: "/search", query: "certificate" }, isHydratable: false },
      ),
    );
    expect(result.html).toContain('value="certificate"');
  });

  it("resolves both locales and the navigation from the existing corpus", () => {
    expect(resolveContent("en-US", "docs", "")?.title).toBe("Introduction");
    expect(resolveContent("pt-BR", "docs", "")?.title).toBeTruthy();
    expect(
      docsNavigation("en-US")
        .flatMap((group) => group.links)
        .some((link) => link.href === "/en-US/docs/get-started/quickstart"),
    ).toBe(true);
    expect(resolveContent("en-US", "docs", "missing")).toBeUndefined();
  });

  it("renders every corpus file through the native server entry", async () => {
    for (const path of contentPaths()) {
      const locale = path.endsWith(".pt-BR") ? "pt-BR" : "en-US";
      const [section, ...parts] = path.split("/");
      const slug = parts.join("/").replace(/\.pt-BR$/, "");
      const page = resolveContent(locale, section ?? "", slug);
      expect(page, path).toBeDefined();
      const route = `/${section}${section === "docs" && slug === "index" ? "" : `/${slug}`}`;
      const validated = await renderPage(
        new Request(`https://signaturekit.dev/${locale}${route}`),
        "test",
      );
      expect(validated._tag, path).toBe("Rendered");
      if (validated._tag === "Rendered")
        expect(validated.application.html, path).toContain(page?.title);
    }
  }, 120_000);

  it("renders the fixture with headings, tables, expressions and safe links", async () => {
    const html = await render(
      '---\ntitle: Example\n---\n\n## A *nested* [link](/ok)\n\n## A *nested* [link](/ok)\n\n## Catálogo de erros [#error-catalog]\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n<Cards>\n<Card title="Next" href="javascript:alert(1)" />\n</Cards>\n\n[unsafe](javascript:alert%281%29)\n\n{"hello"}\n\n```mermaid\na --> b\n```',
    );
    expect(html).toContain('id=\\"a-nested-link\\"');
    expect(html).toContain('id=\\"a-nested-link-1\\"');
    expect(html).toContain('id=\\"error-catalog\\"');
    expect(html).not.toContain("[#error-catalog]");
    expect(html).toContain('<thead><tr><th scope=\\"col\\">One</th>');
    expect(html).toContain("<tbody><tr><td>A</td><td>B</td></tr></tbody>");
    expect(html).not.toContain('href=\\"javascript:');
    expect(html).toContain("hello");
    expect(html).toContain("a --&gt; b");
    expect(html).toContain("data-mermaid-fallback");
  });

  it("splits phrasing around nested flow components with hydratable server markup", async () => {
    const source =
      '---\ntitle: Flow\n---\n\nBefore <Steps><Step title="One">Body</Step></Steps> after\n\n*Em before <Callout title="Notice">Inside **bold**</Callout> em after*\n\n- List before <Cards><Card title="Card">Card body</Card></Cards> list after\n\nCatalog before <ErrorCatalog /> catalog after\n\n<Callout>Outer before <Steps><Step title="Nested">Nested body</Step></Steps> outer after</Callout>';
    const page = parseContent(source);
    const fixtureView = (_model: object, h: HtmlBuilder<never>) => ({
      title: page.title,
      body: h.main([], renderContent(page.nodes, h)),
    });
    const result = await Effect.runPromise(
      Server.renderToString<Model, never, typeof Flags.Type>(
        { Flags, init, view: fixtureView },
        { flags: { locale: "en-US", path: "/docs" }, buildId: "test" },
      ),
    );
    const html = result.html;
    expect(html).toContain(
      '<p>Before </p><ol class="steps"><li><h3>One</h3>Body</li></ol><p> after</p>',
    );
    expect(html).toContain(
      '<p><em>Em before </em></p><aside class="callout info"><strong>Notice</strong>Inside <strong>bold</strong></aside><p><em> em after</em></p>',
    );
    expect(html).toContain('List before </p><div class="cards">');
    expect(html).toContain("Card body</span></div><p> list after");
    expect(html).toContain('<p>Catalog before </p><div class="error-catalog">');
    expect(html).toContain("<p> catalog after</p>");
    expect(html).toContain(
      'Outer before </p><ol class="steps"><li><h3>Nested</h3>Nested body</li></ol><p> outer after',
    );
  });

  it("preserves nested card and link phrasing and rejects unsupported components", async () => {
    const source =
      '---\ntitle: Nested\n---\n\n[Link before <Callout>Notice</Callout> link after](/ok)\n\nBefore <Card title="Outer">card before *em <Steps><Step title="One">Body</Step></Steps> tail*</Card> after';
    const page = parseContent(source);
    const fixtureView = (_model: object, h: HtmlBuilder<never>) => ({
      title: page.title,
      body: h.main([], renderContent(page.nodes, h)),
    });
    const result = await Effect.runPromise(
      Server.renderToString<Model, never, typeof Flags.Type>(
        { Flags, init, view: fixtureView },
        { flags: { locale: "en-US", path: "/docs" }, buildId: "test" },
      ),
    );
    expect(result.html).toContain(
      '<p><a href="/ok">Link before </a></p><aside class="callout info">Notice</aside><p><a href="/ok"> link after</a></p>',
    );
    expect(result.html).toContain(
      '<p>Before </p><div class="card"><strong>Outer</strong><p>card before <em>em </em></p><ol class="steps"><li><h3>One</h3>Body</li></ol><p><em> tail</em></p></div><p> after</p>',
    );
    await expect(
      render(
        "---\ntitle: Unsupported\n---\n\nBefore <Unknown><Steps><Step>Body</Step></Steps></Unknown> after",
      ),
    ).rejects.toThrow("Unsupported MDX component: Unknown");
  });

  it("rejects invalid block contexts and blocks DEL in URLs", async () => {
    for (const body of [
      "Before <Step>Body</Step> after",
      "## Before <Callout>Notice</Callout>",
      "| Head |\n| --- |\n| Before <Callout>Notice</Callout> |",
      "<Steps>Unexpected text</Steps>",
    ]) {
      await expect(render(`---\ntitle: Invalid\n---\n\n${body}`)).rejects.toThrow();
    }
    const page = parseContent("---\ntitle: URL\n---\n\n[link](/safe) ![image](/safe)");
    for (const node of page.nodes) {
      if (node.type === "paragraph") {
        for (const child of node.children) {
          if (child.type === "link" || child.type === "image")
            child.url = "https://example.com/a\u007fb";
        }
      }
    }
    const result = await Effect.runPromise(
      Server.renderToString(
        {
          Flags,
          init,
          view: (_model: object, h: HtmlBuilder<never>) => ({
            title: page.title,
            body: h.main([], renderContent(page.nodes, h)),
          }),
        },
        { flags: { locale: "en-US", path: "/docs" }, buildId: "test" },
      ),
    );
    expect(result.html).toContain('<a href="">link</a>');
    expect(result.html).toContain('<img src="" alt="image">');
    expect(result.html).not.toContain("example.com/a");
  });

  it("deduplicates explicit and automatic headings in document order", async () => {
    const html = await render(
      "---\ntitle: Example\n---\n\n## Same\n\n## First [#same]\n\n## Second [#same]\n\n## Same\n\n## First [#Mixed.ID]\n\n## Second [#Mixed.ID]",
    );
    for (const id of ["same", "same-1", "same-2", "same-3", "Mixed.ID", "Mixed.ID-1"]) {
      expect(html.split(`id=\\"${id}\\"`)).toHaveLength(2);
    }
  });

  it("renders substantial real documentation content including links, code and tables", async () => {
    const page = async (path: string) =>
      JSON.stringify(
        await Effect.runPromise(
          Server.renderToString<Model, Message, typeof Flags.Type>(
            { Flags, init, view },
            { flags: { locale: "en-US", path }, buildId: "test" },
          ),
        ),
      );
    const introduction = await page("/docs");
    expect(introduction).toContain("SignatureKit is a library from");
    expect(introduction).toContain("Choose the path");
    expect(introduction).toContain('href=\\"https://licitei.com.br\\"');
    expect(introduction).toContain("language-ts");
    const recipe = await page("/docs/recipes/react-components");
    expect(recipe).toContain("Install UI with the shadcn registry");
    expect(recipe).toContain("Registry items");
    expect(recipe).toContain("<table>");
    expect(recipe).toContain("signature-certificate-form");
    expect(recipe).toContain("language-tsx");
    expect(recipe).toContain('href=\\"/en-US/docs/recipes/react-pdf-preview\\"');
  });

  it("renders the real error catalog and stable Portuguese anchor", async () => {
    const result = await Effect.runPromise(
      Server.renderToString<Model, Message, typeof Flags.Type>(
        { Flags, init, view },
        { flags: { locale: "pt-BR", path: "/docs/signing/errors" }, buildId: "test" },
      ),
    );
    const html = JSON.stringify(result);
    expect(html).toContain('id=\\"error-catalog\\"');
    expect(signatureKitErrorCatalog).toHaveLength(21);
    for (const entry of signatureKitErrorCatalog) {
      expect(html).toContain(
        `<div id=\\"${entry.code.replace("signature-kit.", "err-")}\\"><code>${entry.code}</code><span>${entry.message}${entry.overridable ? " · editable" : ""}</span></div>`,
      );
    }
    expect(html.split('id=\\"err-')).toHaveLength(signatureKitErrorCatalog.length + 1);
    expect(html).not.toContain("Unsupported MDX component");
  });

  it("rejects malformed frontmatter and unsupported expressions", async () => {
    for (const source of [
      "---\ntitle: [\n---\n",
      "---\ntitle: Example\ndate: 123\n---\n",
      "---\ntitle: Example\n",
      "No frontmatter",
    ]) {
      expect(() => parseContent(source)).toThrow();
    }
    expect(parseContent("---\ntitle: Docs without a date\n---\n").title).toBe(
      "Docs without a date",
    );
    await expect(render("---\ntitle: Example\n---\n\n{danger()}")).rejects.toThrow(
      "Unsupported MDX expression",
    );
    await expect(render("---\ntitle: Example\n---\n\n<Card title={danger()} />")).rejects.toThrow(
      "Unsupported attributes on Card",
    );
    await expect(render("---\ntitle: Example\n---\n\n<Card {...props} />")).rejects.toThrow(
      "Unsupported attributes on Card",
    );
  });

  it("renders both error routes through the hydratable SSR structural validator", async () => {
    for (const locale of ["en-US", "pt-BR"]) {
      const result = await renderPage(
        new Request(`https://signaturekit.dev/${locale}/docs/signing/errors`),
        "test",
      );
      expect(result._tag).toBe("Rendered");
      if (result._tag === "Rendered") {
        expect(result.application.html).toContain("XmlError");
        expect(result.application.html).toContain("PdfError");
      }
    }
  });

  it("returns 404 for missing content", async () => {
    const result = await renderPage(new Request("https://signaturekit.dev/en-US/docs/missing"));
    expect(result._tag).toBe("Responded");
    if (result._tag === "Responded") expect(result.response.status).toBe(404);
  });
});
