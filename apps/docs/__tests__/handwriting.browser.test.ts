import { Effect } from "effect";
import { isSafePdfStampPng } from "@signature-kit/pdf/stamp";
import { expect, it } from "vitest";

it("renders typed handwriting as a private PNG and releases replaced previews", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR";
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
        if (page === null) expect.fail("The native signing page must load");
        page.querySelector<HTMLButtonElement>("#home-open-signer")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(true),
        );
        const typed = page.querySelector<HTMLButtonElement>("#stamp-source-type");
        if (typed === null) expect.fail("The native signer must offer a typed handwritten mark");
        typed.click();
        yield* Effect.promise(() =>
          expect.poll(() => page.getElementById("stamp-handwriting")).not.toBeNull(),
        );
        const input = page.querySelector<HTMLInputElement>("#stamp-handwriting");
        if (input === null) expect.fail("Typed handwriting must expose its name input");
        input.value = "Maria da Costa";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.naturalWidth ?? 0,
              { timeout: 10000 },
            )
            .toBeGreaterThan(100),
        );
        const first = page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.src;
        if (first === undefined) expect.fail("The handwritten PNG must have a private preview URL");
        const bytes = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(first)).arrayBuffer()),
        );
        expect(yield* isSafePdfStampPng(bytes)).toBe(true);
        input.value = "João Lima";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.src)
            .not.toBe(first),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.naturalWidth ?? 0,
            )
            .toBeGreaterThan(100),
        );
        yield* Effect.promise(() => expect(fetch(first)).rejects.toBeDefined());
        const last = page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.src;
        if (last === undefined) expect.fail("The replacement handwritten mark must render");
        page.querySelector<HTMLButtonElement>("#signing-close")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(false),
        );
        yield* Effect.promise(() => expect(fetch(last)).rejects.toBeDefined());
      }),
    ),
    { signal },
  );
}, 20000);
