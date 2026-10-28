import { Effect } from "effect";
import { expect, it } from "vitest";

it("renders documentation diagrams and follows the selected light or dark theme", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR/docs/signing/signers";
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        yield* Effect.promise(() =>
          expect
            .poll(() => frame.contentDocument?.querySelector("h1")?.textContent)
            .toBe("A camada de assinatura"),
        );
        const page = frame.contentDocument;
        if (page === null) expect.fail("The generated documentation page must load");
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector(".content-body svg")?.textContent, { timeout: 10000 })
            .toContain("SignerAdapter"),
        );
        const diagram = page.querySelector<SVGSVGElement>(".content-body svg");
        if (diagram === null) expect.fail("The documentation must display its diagram");
        expect(diagram.getBoundingClientRect().width).toBeGreaterThan(0);
        expect(diagram.textContent).toContain("A1 (.pfx)");
        expect(diagram.textContent).toContain("HSM");
        expect(page.querySelector("code.language-mermaid")).toBeNull();
        const theme = page.querySelector<HTMLSelectElement>("#site-theme");
        if (theme === null) expect.fail("The documentation must expose its theme preference");
        yield* Effect.promise(() => expect.poll(() => theme.disabled).toBe(false));
        theme.value = "light";
        theme.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect.poll(() => page.documentElement.dataset.theme).toBe("light"),
        );
        const node = page.querySelector<SVGElement>(".content-body svg .node rect");
        if (node === null) expect.fail("The real diagram must render its nodes");
        const lightFill = frame.contentWindow?.getComputedStyle(node).fill;
        expect(lightFill).toBeDefined();
        theme.value = "dark";
        theme.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => {
                const current = page.querySelector<SVGElement>(".content-body svg .node rect");
                return current === null
                  ? undefined
                  : frame.contentWindow?.getComputedStyle(current).fill;
              },
              { timeout: 10000 },
            )
            .not.toBe(lightFill),
        );
        expect(page.querySelector(".content-body svg")?.textContent).toContain("SignerAdapter");
        theme.value = "light";
        theme.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => {
                const current = page.querySelector<SVGElement>(".content-body svg .node rect");
                return current === null
                  ? undefined
                  : frame.contentWindow?.getComputedStyle(current).fill;
              },
              { timeout: 10000 },
            )
            .toBe(lightFill),
        );
      }),
    ),
    { signal },
  );
}, 30000);
