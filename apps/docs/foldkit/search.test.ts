import { Popover } from "@foldkit/ui";
import { describe, expect, it } from "vitest";
import { searchDocs } from "./search";
import { parseContent, renderContent } from "./content";
import type { HtmlBuilder } from "foldkit/html";
import { renderPage } from "./entry.server";
import { signatureKitErrorCatalog } from "@signature-kit/signatures";
import { Flags, init, Message, update, view } from "./main";
import { Effect } from "effect";
import * as Server from "foldkit/experimental/server";

describe("documentation search", () => {
  it("indexes visible literal expressions rendered by native SSR", async () => {
    const page = parseContent(
      '---\ntitle: Fixture\n---\n\nBefore {"unique needle"} after\n\n{12345}',
    );
    const pages = [{ slug: "fixture", page }];
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
    for (const term of ["unique needle", "12345"]) {
      expect(result.html).toContain(term);
      expect(searchDocs("en-US", term, pages).length).toBeGreaterThan(0);
    }
  });

  it("finds titles and body text in the selected locale", () => {
    expect(
      searchDocs("en-US", "INTRODUCTION").some((result) => result.href === "/en-US/docs"),
    ).toBe(true);
    expect(
      searchDocs("en-US", "shadcn registry").some((result) =>
        result.href.startsWith("/en-US/docs/recipes/react-components"),
      ),
    ).toBe(true);
    const accented = searchDocs("pt-BR", "certificado");
    expect(accented.length).toBeGreaterThan(0);
    expect(accented.every((result) => result.href.startsWith("/pt-BR/docs"))).toBe(true);
    expect(searchDocs("pt-BR", "ASSINATURA")).toEqual(searchDocs("pt-BR", "assinatura"));
    const unaccented = searchDocs("pt-BR", "servico");
    expect(unaccented.length).toBeGreaterThan(0);
    expect(unaccented).toEqual(searchDocs("pt-BR", "serviço"));
  });

  it("uses the rendered explicit heading anchor and bounds unsafe queries", () => {
    expect(
      searchDocs("pt-BR", "catálogo de erros").some((result) =>
        result.href.endsWith("#error-catalog"),
      ),
    ).toBe(true);
    expect(searchDocs("en-US", " ")).toEqual([]);
    expect(searchDocs("en-US", "x".repeat(201))).toEqual([]);
    expect(searchDocs("en-US", "<script>alert(1)</script>")).toEqual([]);
  });

  it("indexes visible attributes and the generated catalog with real anchors", async () => {
    const steps = searchDocs("pt-BR", "Instale os pacotes");
    const step = steps.find(
      (result) =>
        result.heading === "Instale os pacotes" &&
        result.href.startsWith("/pt-BR/docs/get-started/installation"),
    );
    expect(step).toBeDefined();
    if (step !== undefined) {
      const [path, anchor] = step.href.split("#");
      const page = await renderPage(new Request(`https://signaturekit.dev${path}`), "test");
      expect(page._tag).toBe("Rendered");
      if (page._tag === "Rendered") {
        expect(page.application.html).toContain("Instale os pacotes");
        if (anchor !== undefined && anchor.length > 0)
          expect(page.application.html).toContain(`id="${decodeURIComponent(anchor)}"`);
      }
    }
    expect(
      searchDocs("pt-BR", "Verificações locais não são validade jurídica").length,
    ).toBeGreaterThan(0);
    expect(searchDocs("pt-BR", "Carregue um A1, leia a identidade").length).toBeGreaterThan(0);
    const entry = signatureKitErrorCatalog[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const match = searchDocs("pt-BR", entry.code).find((result) =>
      result.href.includes("/signing/errors#err-"),
    );
    expect(match).toBeDefined();
    if (match === undefined) return;
    const [path, anchor] = match.href.split("#");
    const page = await renderPage(new Request(`https://signaturekit.dev${path}`), "test");
    expect(page._tag).toBe("Rendered");
    if (page._tag === "Rendered")
      expect(page.application.html).toContain(`id="${decodeURIComponent(anchor ?? "")}"`);
  });

  it("updates the single model and recalculates results for the locale", async () => {
    const initial = init({ locale: "pt-BR", path: "/search" }).model;
    const changed = update(initial, Message.QueryChanged({ value: "configuração & a/b" })).model;
    expect(changed.query).toBe("configuração & a/b");
    expect(update(changed, Message.SearchSubmitted()).model.results).toEqual(
      searchDocs("pt-BR", changed.query),
    );
    const toggled = update(
      changed,
      Message.GotLanguagePopoverMessage({ message: Popover.Message.RequestedOpen() }),
    ).model;
    expect(toggled.languagePopover.isOpen).toBe(true);
    const rendered = await Effect.runPromise(
      Server.renderToString(
        { Flags, init: () => ({ model: toggled }), view },
        { flags: { locale: "pt-BR", path: "/search" }, isHydratable: false },
      ),
    );
    expect(rendered.html).toContain("/en-US/search?q=configura%C3%A7%C3%A3o+%26+a%2Fb");
    expect(rendered.html).toContain('aria-current="page"');
    expect(init({ locale: "en-US", path: "/search", query: changed.query }).model.results).toEqual(
      searchDocs("en-US", changed.query),
    );
  });

  it("bounds and escapes SSR query flags", async () => {
    const malicious = "</script><script>alert(1)</script>";
    const page = await renderPage(
      new Request(`https://signaturekit.dev/en-US/search?q=${encodeURIComponent(malicious)}`),
      "test",
    );
    expect(page._tag).toBe("Rendered");
    if (page._tag === "Rendered") expect(page.application.html).not.toContain(malicious);
    const long = await renderPage(
      new Request(`https://signaturekit.dev/en-US/search?q=${"x".repeat(201)}`),
      "test",
    );
    expect(JSON.stringify(long)).not.toContain("x".repeat(201));
  });

  it("renders a localized GET search and results on the server", async () => {
    const result = JSON.stringify(
      await renderPage(
        new Request("https://signaturekit.dev/pt-BR/search?q=cat%C3%A1logo%20de%20erros"),
        "test",
      ),
    );
    expect(result).toContain("Buscar na documentação");
    expect(result).toContain("#error-catalog");
    expect(result).toContain('name=\\"q\\"');
    const empty = JSON.stringify(
      await renderPage(new Request("https://signaturekit.dev/en-US/search"), "test"),
    );
    expect(empty).toContain("Enter a search term");
  });
});
