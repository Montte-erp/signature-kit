import { Effect } from "effect";
import { expect, it } from "vitest";

it("renders and updates the actual PDF stamp preview and releases its canvas on close", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR";
            element.style.width = "390px";
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
        if (page === null) expect.fail("The native signing home must load");
        page.querySelector<HTMLButtonElement>("#home-open-signer")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(true),
        );
        const canvas = page.querySelector<HTMLCanvasElement>("#stamp-preview-canvas");
        if (canvas === null) expect.fail("The native signer must preview the complete PDF stamp");
        yield* Effect.promise(() =>
          expect.poll(() => canvas.dataset.state, { timeout: 10000 }).toBe("ready"),
        );
        const hasColor = (red: number, green: number, blue: number): boolean => {
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (pixels === undefined) return false;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] === red && pixels[index + 1] === green && pixels[index + 2] === blue)
              return true;
          }
          return false;
        };
        expect(hasColor(59, 91, 219)).toBe(true);
        const original = canvas.toDataURL();
        const color = page.querySelector<HTMLInputElement>("#stamp-color");
        const title = page.querySelector<HTMLInputElement>("#stamp-title");
        if (color === null || title === null)
          expect.fail("The stamp must expose its appearance settings");
        title.value = "Reviewed PDF";
        title.dispatchEvent(new InputEvent("input", { bubbles: true }));
        color.value = "#14532d";
        color.dispatchEvent(new InputEvent("input", { bubbles: true }));
        yield* Effect.promise(() =>
          expect.poll(() => hasColor(20, 83, 45), { timeout: 10000 }).toBe(true),
        );
        expect(canvas.toDataURL()).not.toBe(original);
        page.querySelector<HTMLButtonElement>("#signing-close")?.click();
        yield* Effect.promise(() => expect.poll(() => canvas.width).toBe(0));
        expect(canvas.height).toBe(0);
      }),
    ),
    { signal },
  );
}, 20000);
