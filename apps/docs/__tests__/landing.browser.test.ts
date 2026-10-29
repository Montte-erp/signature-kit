import { Effect } from "effect";
import { describe, expect, it } from "vitest";

describe("Foldkit landing page", () => {
  it("hydrates localized provider and installation controls from the generated home", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const frame = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const element = document.createElement("iframe");
              element.style.width = "390px";
              element.src = "/pt-BR";
              document.body.append(element);
              return element;
            }),
            (element) => Effect.sync(() => element.remove()),
          );
          yield* Effect.promise(() =>
            expect
              .poll(() => frame.contentDocument?.querySelector("h1")?.textContent)
              .toBe("Um ponto único de assinatura tipado para cada documento."),
          );
          const page = frame.contentDocument;
          if (page === null) expect.fail("The generated home must load in the frame");
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector<HTMLSelectElement>("#site-theme")?.disabled)
              .toBe(false),
          );
          const provider = page.querySelector<HTMLButtonElement>("#home-provider-assinafy");
          if (provider === null) expect.fail("The home must offer the Assinafy example");
          provider.click();
          yield* Effect.promise(() =>
            expect.poll(() => provider.getAttribute("aria-selected")).toBe("true"),
          );
          expect(page.getElementById("home-example-clicksign.ts")?.hidden).toBe(true);
          expect(page.getElementById("home-example-assinafy.ts")?.hidden).toBe(false);
          expect(page.getElementById("home-example-assinafy.ts")?.textContent).toContain(
            "AssinafySignatureRequest",
          );
          provider.focus();
          provider.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
          );
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                page.getElementById("home-provider-zapsign")?.getAttribute("aria-selected"),
              )
              .toBe("true"),
          );
          expect(page.activeElement?.id).toBe("home-provider-zapsign");
          page.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
          );
          yield* Effect.promise(() =>
            expect.poll(() => page.activeElement?.id).toBe("home-provider-documenso"),
          );
          page.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
          );
          yield* Effect.promise(() =>
            expect.poll(() => page.activeElement?.id).toBe("home-provider-clicksign"),
          );
          const previous = page.querySelector<HTMLButtonElement>("#home-provider-previous");
          const next = page.querySelector<HTMLButtonElement>("#home-provider-next");
          if (previous === null || next === null)
            expect.fail("Provider examples must retain visible previous and next controls");
          previous.focus();
          previous.click();
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                page.getElementById("home-provider-documenso")?.getAttribute("aria-selected"),
              )
              .toBe("true"),
          );
          expect(page.activeElement).toBe(previous);
          next.focus();
          next.click();
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                page.getElementById("home-provider-clicksign")?.getAttribute("aria-selected"),
              )
              .toBe("true"),
          );
          expect(page.activeElement).toBe(next);
          const npm = page.querySelector<HTMLButtonElement>("#home-install-npm");
          if (npm === null) expect.fail("The home must offer npm installation");
          npm.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.getElementById("home-install-command")?.textContent)
              .toBe("npm install @signature-kit/signatures @signature-kit/a1"),
          );
          const copy = page.querySelector<HTMLButtonElement>("#home-copy-install");
          if (copy === null) expect.fail("The native installation command must offer copying");
          copy.focus();
          copy.click();
          yield* Effect.promise(() => expect.poll(() => copy.textContent).toBe("Copiado"));
          yield* Effect.promise(() =>
            expect
              .poll(() => navigator.clipboard.readText())
              .toBe("npm install @signature-kit/signatures @signature-kit/a1"),
          );
          const copyProvider = page.querySelector<HTMLButtonElement>("#home-copy-provider");
          if (copyProvider === null)
            expect.fail("The selected provider example must offer copying");
          copyProvider.focus();
          copyProvider.click();
          yield* Effect.promise(() => expect.poll(() => copyProvider.textContent).toBe("Copiado"));
          yield* Effect.promise(() =>
            expect
              .poll(() => navigator.clipboard.readText())
              .toBe(
                page.getElementById("home-example-clicksign.ts")?.querySelector("code")
                  ?.textContent,
              ),
          );
          expect(page.querySelector('a[href="/pt-BR/docs/get-started/quickstart"]')).not.toBeNull();
          expect(page.querySelector('a[hreflang="en-US"]')?.getAttribute("href")).toBe("/en-US");
          expect(page.documentElement.lang).toBe("pt-BR");
          expect(page.documentElement.scrollWidth).toBeLessThanOrEqual(
            page.documentElement.clientWidth,
          );
        }),
      ),
    );
  });
});
