import { Option } from "effect";
import * as Url from "foldkit/url";
import { describe, expect, it } from "vitest";

import { localizedSitePath, parseSiteUrl } from "../lib/site-route";

describe("localized site navigation", () => {
  it("builds canonical home links for both supported languages", () => {
    expect(localizedSitePath("/", "en-US")).toBe("/en-US");
    expect(localizedSitePath("", "pt-BR")).toBe("/pt-BR");
  });
  it("preserves documentation, article and release paths", () => {
    expect(localizedSitePath("/docs/signing/pdf", "pt-BR")).toBe("/pt-BR/docs/signing/pdf");
    expect(localizedSitePath("blog/signatures", "en-US")).toBe("/en-US/blog/signatures");
    expect(localizedSitePath("/changelog", "en-US")).toBe("/en-US/changelog");
  });
  it("resolves localized content and rejects non-canonical locale casing", () => {
    const content = Option.getOrThrow(
      Url.fromString("https://signaturekit.dev/pt-BR/docs/signing/pdf"),
    );
    const invalid = Option.getOrThrow(Url.fromString("https://signaturekit.dev/pt-br/docs"));
    expect(parseSiteUrl(content)).toEqual({
      _tag: "Page",
      locale: "pt-BR",
      path: "docs/signing/pdf",
    });
    expect(parseSiteUrl(invalid)).toEqual({ _tag: "NotFound", path: "/pt-br/docs" });
  });
});
