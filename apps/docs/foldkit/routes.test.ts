import { describe, expect, it } from "vitest";
import { homeRoute, pageRoute, parsePublicUrl } from "./routes";
import { prerenderPaths, renderPage } from "./entry.server";

describe("public routes", () => {
  it("round trips the prerender inventory and localized encoded paths", () => {
    for (const path of [
      ...prerenderPaths,
      pageRoute({ locale: "pt-BR", path: "blog/tags/s%C3%A3o-paulo-%26-100%25" }),
    ]) {
      const route = parsePublicUrl(`https://signaturekit.dev${path}?q=a+%26+b`);
      expect(route, path).toBeDefined();
      if (route === undefined) continue;
      expect(route._tag === "Home" ? homeRoute(route) : pageRoute(route)).toBe(path);
    }
  });

  it("rejects noncanonical and unsupported locale paths", () => {
    for (const path of ["/", "/pt-br", "/en-US/", "/en-US//docs", "/fr-FR/docs"]) {
      expect(parsePublicUrl(`https://signaturekit.dev${path}`), path).toBeUndefined();
    }
  });

  it("preserves public routing and rejects unknown pages at the server boundary", async () => {
    for (const path of [
      "/en-US",
      "/pt-BR",
      "/en-US/search?q=a+%26+b",
      "/pt-BR/assine-documentos-gratis",
    ]) {
      const response = await renderPage(new Request(`https://signaturekit.dev${path}`), "test");
      expect(response._tag, path).toBe("Rendered");
    }
    const response = await renderPage(
      new Request("https://signaturekit.dev/en-US/not-a-page"),
      "test",
    );
    expect(response._tag).toBe("Responded");
    if (response._tag === "Responded") expect(response.response.status).toBe(404);
  });
});
