import { Effect } from "effect";
import { expect, it } from "vitest";

it("keeps an unsent private comment after feedback delivery is refused", async ({ signal }) => {
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
        const useful = page.querySelector<HTMLButtonElement>("#site-feedback-good");
        if (useful === null) expect.fail("Published documentation must offer page feedback");
        useful.click();
        yield* Effect.promise(() =>
          expect.poll(() => useful.getAttribute("aria-pressed")).toBe("true"),
        );
        const form = page.querySelector<HTMLFormElement>("#site-feedback-form");
        const comment = page.querySelector<HTMLTextAreaElement>("#site-feedback-message");
        if (form === null || comment === null)
          expect.fail("Page feedback must accept an optional comment");
        const draft = "private-feedback-" + crypto.randomUUID();
        comment.value = draft;
        comment.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector("#site-feedback [role=alert]")?.textContent)
            .toBe("Não foi possível enviar seu comentário. Tente novamente mais tarde."),
        );
        expect(comment.value).toBe(draft);
        expect(page.querySelector("#site-feedback [role=status]")).toBeNull();
        expect(page.location.pathname).toBe("/pt-BR/docs/get-started/installation");
      }),
    ),
    { signal },
  );
}, 30000);
