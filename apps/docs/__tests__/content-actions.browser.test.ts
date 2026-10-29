import { mountCodeBlocks } from "../src/site/code-block.ts";
import { Effect, Exit } from "effect";
import { expect, it } from "vitest";

it("copies installation commands, highlighted examples and the actual Markdown source", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR/docs/get-started/installation";
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () =>
                frame.contentDocument?.querySelector<HTMLSelectElement>("#site-theme")?.disabled,
            )
            .toBe(false),
        );
        const page = frame.contentDocument;
        if (page === null) expect.fail("The published documentation must load");
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector('[data-code-widget="package-install"]'))
            .not.toBeNull(),
        );
        const install = page.querySelector<HTMLElement>('[data-code-widget="package-install"]');
        if (install === null)
          expect.fail("Package instructions must expose native installation controls");
        expect(install.querySelectorAll("button[data-manager]")).toHaveLength(4);
        const npm = install.querySelector<HTMLButtonElement>('button[data-manager="npm"]');
        if (npm === null) expect.fail("The installation instructions must support npm");
        npm.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => install.querySelector("pre code")?.textContent)
            .toBe("npm install @signature-kit/signatures @signature-kit/a1"),
        );
        const installCopy = install.querySelector<HTMLButtonElement>('[data-code-action="copy"]');
        if (installCopy === null) expect.fail("The selected installation command must be copyable");
        installCopy.focus();
        installCopy.click();
        yield* Effect.promise(() => expect.poll(() => installCopy.textContent).toBe("Copiado"));
        yield* Effect.promise(() =>
          expect
            .poll(() => navigator.clipboard.readText())
            .toBe("npm install @signature-kit/signatures @signature-kit/a1"),
        );
        const example = page.querySelector<HTMLElement>("figure.code-block");
        if (example === null) expect.fail("The page must retain its highlighted examples");
        const code = example.querySelector("pre code")?.textContent;
        expect(code).toContain("a1SignaturesLayer");
        const copy = example.querySelector<HTMLButtonElement>('[data-code-action="copy"]');
        if (copy === null) expect.fail("The highlighted example must be copyable");
        copy.focus();
        copy.click();
        yield* Effect.promise(() => expect.poll(() => copy.textContent).toBe("Copiado"));
        yield* Effect.promise(() => expect.poll(() => navigator.clipboard.readText()).toBe(code));
        const markdownLink = page.querySelector<HTMLAnchorElement>("#site-view-markdown");
        if (markdownLink === null) expect.fail("The documentation must expose its Markdown source");
        expect(markdownLink.getAttribute("href")).toBe("/pt-BR/docs/get-started/installation.md");
        const markdown = yield* Effect.promise(() =>
          fetch(markdownLink.href).then((response) => response.text()),
        );
        const copyMarkdown = page.querySelector<HTMLButtonElement>("#site-copy-markdown");
        if (copyMarkdown === null) expect.fail("The complete Markdown page must be copyable");
        copyMarkdown.focus();
        copyMarkdown.click();
        yield* Effect.promise(() => expect.poll(() => copyMarkdown.textContent).toBe("Copiado"));
        yield* Effect.promise(() =>
          expect.poll(() => navigator.clipboard.readText()).toBe(markdown),
        );
        expect(page.querySelector<HTMLAnchorElement>("#site-view-source")?.href).toBe(
          "https://github.com/Montte-erp/signature-kit/blob/main/apps/docs/content/docs/get-started/installation.pt-BR.mdx",
        );
        expect(page.title).toContain("Instalação");
        expect(page.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
          "https://signaturekit.dev/pt-BR/docs/get-started/installation",
        );
      }),
    ),
    { signal },
  );
}, 30000);

it("restores authored code when its widget scope exits with a failure", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("section");
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        const original = document.createElement("pre");
        const code = document.createElement("code");
        code.className = "language-package-install";
        code.textContent = "@signature-kit/signatures @signature-kit/a1";
        original.append(code);
        host.append(original);
        const exit = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* mountCodeBlocks(host, "en-US");
            yield* Effect.promise(() =>
              expect
                .poll(() => host.querySelector('[data-code-widget="package-install"]'))
                .not.toBeNull(),
            );
            return yield* Effect.fail("The article host ended the widget scope.");
          }),
        ).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        expect(host.querySelector("pre")).toBe(original);
        expect(host.querySelector("[data-code-widget]")).toBeNull();
        expect(host.textContent).toBe("@signature-kit/signatures @signature-kit/a1");
      }),
    ),
    { signal },
  );
}, 10000);
