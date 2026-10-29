import { readFile } from "node:fs/promises";

import { Effect } from "effect";
import { renderDocument, renderToString } from "foldkit/experimental/server";
import { describe, expect, it } from "vitest";

import { contentHighlighterLayer } from "../src/content/highlight";
import { compileContent } from "../src/content/compile";
import { contentApplication } from "../src/site/application";

describe("Foldkit content rendering", () => {
  it("renders published content with its language and canonical URL", async () => {
    const source = await readFile(
      new URL("../content/changelog/native-cms-buffers.mdx", import.meta.url),
      "utf8",
    );
    const rendered = await Effect.runPromise(
      Effect.gen(function* () {
        const page = yield* compileContent(source);
        return yield* renderToString(contentApplication, {
          flags: {
            navigation: [],
            alternates: ["en-US", "pt-BR"],
            page,
            locale: "en-US",
            path: "changelog/native-cms-buffers",
            siteUrl: "https://signaturekit.dev",
          },
          isHydratable: false,
        });
      }).pipe(Effect.provide(contentHighlighterLayer)),
    );
    const html = renderDocument(rendered, {
      entryScript: "/assets/site.js",
      stylesheets: [],
      modulePreloads: [],
    });

    expect(html).toContain('<html lang="en-US"');
    expect(html).toContain("Native byte conversion and verified release gates — SignatureKit");
    expect(html).toContain('href="https://signaturekit.dev/en-US/changelog/native-cms-buffers"');
    expect(html).toContain("Use native Uint8Array copies");
    expect(html).toContain('href="/en-US/docs"');
    expect(html).not.toContain("react-server-dom");
    const footer = html.slice(html.indexOf("<footer"));
    expect(footer).toContain('href="/en-US/docs/get-started/quickstart"');
    expect(footer).toContain('href="/en-US/docs/signing/pdf"');
    expect(footer).toContain('href="/en-US/docs/signing/xml"');
    expect(footer).toContain('href="/en-US/docs/signing/errors"');
    expect(footer).toContain('href="/en-US/docs/providers/request-shape"');
    expect(footer).toContain('href="https://github.com/Montte-erp/signature-kit/issues"');
    expect(footer).toContain('href="https://montte.co"');
  });
});
