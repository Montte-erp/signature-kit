import { Effect, Layer } from "effect";
import * as Runtime from "foldkit/runtime";
import { describe, expect, it } from "vitest";

import { pdfPreviewBrowserLayer } from "../src/site/pdf-preview-browser.ts";
import { contentApplication, ContentFlags } from "../src/site/application";

describe("Foldkit content runtime", () => {
  it("renders a localized page under a disposable native runtime", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const container = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const element = document.createElement("div");
              const root = document.createElement("div");
              root.id = "content-runtime-" + crypto.randomUUID();
              element.append(root);
              document.body.append(element);
              return element;
            }),
            (element) => Effect.sync(() => element.remove()),
          );
          const flags = ContentFlags.make({
            navigation: [],
            alternates: ["en-US", "pt-BR"],
            page: {
              title: "Assinatura no navegador",
              headings: [],
              text: "Certificados A1 e documentos PDF.",
              html: "<p>Certificados A1 e documentos PDF.</p>",
            },
            locale: "pt-BR",
            path: "docs/a1-signing/browser-pdf-flow",
            siteUrl: "https://signaturekit.dev",
          });
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              Runtime.embed(
                Runtime.makeApplication({
                  ...contentApplication,
                  resources: pdfPreviewBrowserLayer.pipe(
                    Layer.provideMerge(contentApplication.resources),
                  ),
                  container: container.querySelector<HTMLElement>("div"),
                }),
                {
                  flags: Effect.succeed(flags),
                },
              ),
            ),
            (handle) => Effect.sync(() => handle.dispose()),
          );

          yield* Effect.promise(() =>
            expect
              .poll(() => container.querySelector("h1")?.textContent)
              .toBe("Assinatura no navegador"),
          );
          expect(container.querySelector('a[href="/pt-BR/docs"]')?.textContent).toBe(
            "Documentação",
          );
          expect(container.textContent).toContain("Certificados A1 e documentos PDF.");
          expect(document.documentElement.lang).toBe("pt-BR");
          expect(document.title).toBe("Assinatura no navegador — SignatureKit");
          const trigger = container.querySelector<HTMLButtonElement>("#site-search-trigger");
          if (trigger === null) expect.fail("Search must be available from the site header");
          trigger.focus();
          trigger.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => container.querySelector<HTMLDialogElement>("#site-search-dialog")?.open)
              .toBe(true),
          );
          const input = container.querySelector<HTMLInputElement>("#site-search-input");
          if (input === null) expect.fail("Search must expose its input");
          input.value = "certificados";
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  container.querySelector(
                    '#site-search-results a[href="/pt-BR/docs/signing/certificates"]',
                  )?.textContent,
              )
              .toBe("Certificados A1"),
          );
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => container.querySelector<HTMLDialogElement>("#site-search-dialog")?.open)
              .toBe(false),
          );
          expect(document.activeElement).toBe(trigger);
        }),
      ),
    );
  });
});
