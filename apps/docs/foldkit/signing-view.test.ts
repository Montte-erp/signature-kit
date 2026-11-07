import { expect, it } from "vitest";
import { Effect } from "effect";
import * as Server from "foldkit/experimental/server";
import { Flags, init, view } from "./main";
import { renderPage, prerenderPaths } from "./entry.server";

it("renders both canonical signing routes and links them from the home pages", async () => {
  for (const [locale, path, title] of [
    ["pt-BR", "assine-documentos-gratis", "Assine documentos grátis"],
    ["en-US", "sign-free", "Sign documents for free"],
  ]) {
    const route = `/${locale}/${path}`;
    expect(prerenderPaths).toContain(route);
    const page = await renderPage(new Request(`https://signaturekit.dev${route}`), "test");
    expect(page._tag).toBe("Rendered");
    expect(JSON.stringify(page)).toContain(title);
    const home = await renderPage(new Request(`https://signaturekit.dev/${locale}`), "test");
    expect(JSON.stringify(home)).toContain(route);
  }
});

it("renders language links for signing routes and preserves documentation and article paths", async () => {
  for (const [locale, path, english, portuguese] of [
    ["pt-BR", "/assine-documentos-gratis", "/en-US/sign-free", "/pt-BR/assine-documentos-gratis"],
    ["en-US", "/sign-free", "/en-US/sign-free", "/pt-BR/assine-documentos-gratis"],
    ["en-US", "/docs/example", "/en-US/docs/example", "/pt-BR/docs/example"],
    ["en-US", "/blog/example", "/en-US/blog/example", "/pt-BR/blog/example"],
  ] satisfies ["en-US" | "pt-BR", string, string, string][]) {
    const openMenu = (flags: typeof Flags.Type) => ({
      model: { ...init(flags).model, menuOpen: true },
    });
    const page = JSON.stringify(
      await Effect.runPromise(
        Server.renderToString(
          { Flags, init: openMenu, view },
          { flags: { locale, path }, buildId: "test" },
        ),
      ),
    );
    expect(page).toContain(`href=\\"${english}\\"`);
    expect(page).toContain(`href=\\"${portuguese}\\"`);
  }
});
