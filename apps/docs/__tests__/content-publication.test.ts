import { readFile } from "node:fs/promises";

import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { signatureKitErrorCatalog } from "@signature-kit/signatures";

import { contentHighlighterLayer } from "../src/content/highlight";
import { compileContent } from "../src/content/compile";

describe("content publication", () => {
  it("publishes release metadata and readable content without a React renderer", async () => {
    const source = await readFile(
      new URL("../content/changelog/native-cms-buffers.mdx", import.meta.url),
      "utf8",
    );
    const page = await Effect.runPromise(
      compileContent(source).pipe(Effect.provide(contentHighlighterLayer)),
    );

    expect(page.title).toBe("Native byte conversion and verified release gates");
    expect(page.date).toBe("2026-09-22T11:35:16.185Z");
    expect(page.packages?.["@signature-kit/cms"]?.version).toBe("0.2.2");
    expect(page.html).toContain("<h2");
    expect(page.html).toContain("Use native Uint8Array copies");
    expect(page.html).not.toContain("packages:");
    expect(page.headings).toContainEqual({
      tag: "h2",
      id: "native-byte-conversion-and-verified-release-gates",
      title: "Native byte conversion and verified release gates",
    });
  });
  it("keeps documentation cards as navigable links", async () => {
    const source = await readFile(new URL("../content/docs/index.mdx", import.meta.url), "utf8");
    const page = await Effect.runPromise(
      compileContent(source).pipe(Effect.provide(contentHighlighterLayer)),
    );

    expect(page.html).toContain('href="/en-US/docs/get-started/installation"');
    expect(page.html).toContain("Install A1");
    expect(page.html).toContain(
      "Add the Effect runtime, the core Signatures service, and the PKCS#12 signer.",
    );
    expect(page.html).not.toContain("<Card");
  });
  it("publishes installation steps and preserves their instructions", async () => {
    const source = await readFile(
      new URL("../content/docs/get-started/installation.mdx", import.meta.url),
      "utf8",
    );
    const page = await Effect.runPromise(
      compileContent(source).pipe(Effect.provide(contentHighlighterLayer)),
    );

    expect(page.html).toContain('class="content-steps"');
    expect(page.html).toContain("Install the packages");
    expect(page.html).toContain("Provide the Signatures layer");
    expect(page.html).toContain('class="content-step"');
  });
  it("publishes the live package error catalog with stable deep links", async () => {
    const source = await readFile(
      new URL("../content/docs/signing/errors.mdx", import.meta.url),
      "utf8",
    );
    const page = await Effect.runPromise(
      compileContent(source).pipe(Effect.provide(contentHighlighterLayer)),
    );

    for (const entry of signatureKitErrorCatalog) {
      expect(page.html).toContain(entry.code);
      expect(page.html).toContain(`id="${entry.code.replace("signature-kit.", "err-")}"`);
    }
    expect(page.html).toContain("Default message");
  });
  it("highlights TypeScript without changing the displayed source", async () => {
    const source = "---\ntitle: Example\n---\n\n```ts\nconst amount = 42\n```";
    const page = await Effect.runPromise(
      compileContent(source).pipe(Effect.provide(contentHighlighterLayer)),
    );

    expect(page.html).toContain('class="shiki');
    expect(page.html).toContain("const");
    expect(page.html).toContain("amount");
    expect(page.html).toContain("42");
    expect(page.html).toContain("--shiki-dark");
  });
  it("rejects executable MDX expressions instead of dropping content", async () => {
    const source = "---\ntitle: Unsupported expression\n---\n\n{1 + 1}";
    const result = await Effect.runPromise(
      Effect.result(compileContent(source)).pipe(Effect.provide(contentHighlighterLayer)),
    );

    expect(Result.isFailure(result)).toBe(true);
  });
});
