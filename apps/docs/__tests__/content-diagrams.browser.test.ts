import { Effect } from "effect";
import { expect, it } from "vitest";

it("renders documentation diagrams in the hydrated production page", async ({ signal }) => {
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
      }),
    ),
    { signal },
  );
}, 20000);
