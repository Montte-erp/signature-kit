import { describe, expect, it } from "vitest";

import { blogTagIndexes } from "../src/content/catalog.ts";
import { ContentEntry } from "../src/content/config.ts";

describe("blog taxonomy", () => {
  it("groups equivalent tag URLs and keeps articles in their publication language", () => {
    const first = ContentEntry.make({
      locale: "en-US",
      path: "blog/first",
      page: {
        title: "First article",
        html: "<p>First</p>",
        text: "First",
        headings: [],
        tags: ["Digital Signatures", "Effect"],
      },
    });
    const second = ContentEntry.make({
      ...first,
      path: "blog/second",
      page: { ...first.page, title: "Second article", tags: ["digital signatures"] },
    });
    const portuguese = ContentEntry.make({
      ...first,
      locale: "pt-BR",
      path: "blog/portuguese",
      page: { ...first.page, title: "Artigo em português" },
    });
    const pages = blogTagIndexes([first, second, portuguese], "en-US");
    const tag = pages.find((page) => page.path === "blog/tags/digital-signatures");

    expect(pages.filter((page) => page.path === "blog/tags/digital-signatures")).toHaveLength(1);
    expect(tag?.page.description).toBe("2 matching blog posts.");
    expect(tag?.page.html).toContain('href="/en-US/blog/first"');
    expect(tag?.page.html).toContain('href="/en-US/blog/second"');
    expect(tag?.page.html).not.toContain("Artigo em português");
  });
});
