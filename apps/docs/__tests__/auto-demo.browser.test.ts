import { inspectPdf } from "./pdf-inspection.browser.ts";
import { Effect } from "effect";
import { expect, it } from "vitest";

it("prepares four real demonstration PDFs when their native section becomes visible", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR";
            element.style.width = "1000px";
            element.style.height = "700px";
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
        if (page === null) expect.fail("The native home must load");
        const demo = page.querySelector<HTMLElement>("#home-auto-demo");
        if (demo === null)
          expect.fail("The native home must include the automatic signing demonstration");
        frame.scrollIntoView();
        demo.scrollIntoView();
        yield* Effect.promise(() => expect.poll(() => demo.dataset.active).toBe("true"));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => {
                expect(page.title, page.body.textContent ?? "").not.toBe("Application Crash");
                return demo.querySelectorAll('[data-demo-state="ready"]').length;
              },
              {
                timeout: 15000,
              },
            )
            .toBe(4),
        );
        expect(demo.textContent).toContain("O passo criptográfico CMS aqui é ilustrativo");
        const tabs = [...demo.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        expect(tabs).toHaveLength(4);
        const images = new Set<string>();
        for (const tab of tabs) {
          tab.click();
          yield* Effect.promise(() =>
            expect.poll(() => tab.getAttribute("aria-selected")).toBe("true"),
          );
          yield* Effect.promise(() =>
            expect
              .poll(
                () => demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.dataset.state,
                { timeout: 10000 },
              )
              .toBe("ready"),
          );
          const canvas = demo.querySelector<HTMLCanvasElement>("#home-auto-preview");
          if (canvas === null)
            expect.fail("Each real example PDF must render in the native preview");
          expect(canvas.width).toBeGreaterThan(500);
          expect(canvas.height).toBeGreaterThan(700);
          images.add(canvas.toDataURL());
        }
        expect(images.size).toBe(4);
        expect(demo.querySelector<HTMLButtonElement>("#home-auto-run")?.disabled).toBe(false);
      }),
    ),
    { signal },
  );
}, 45000);

it("stamps the illustrative queue, downloads a real PDF and restores its original preview", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR";
            element.style.width = "1000px";
            element.style.height = "700px";
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
        if (page === null) expect.fail("The native home must load");
        const demo = page.querySelector<HTMLElement>("#home-auto-demo");
        if (demo === null) expect.fail("The automatic PDF demonstration must be available");
        demo.scrollIntoView();
        yield* Effect.promise(() =>
          expect
            .poll(() => demo.querySelectorAll('[data-demo-state="ready"]').length, {
              timeout: 15000,
            })
            .toBe(4),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.dataset.state,
              { timeout: 10000 },
            )
            .toBe("ready"),
        );
        const original = demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.toDataURL();
        const run = demo.querySelector<HTMLButtonElement>("#home-auto-run");
        if (run === null) expect.fail("The prepared examples must support processing the queue");
        run.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => demo.querySelectorAll('[data-demo-state="stamped"]').length, {
              timeout: 15000,
            })
            .toBe(4),
        );
        expect(demo.textContent).toContain("O passo criptográfico CMS aqui é ilustrativo");
        demo.querySelector<HTMLButtonElement>('[role="tab"]')?.click();
        yield* Effect.promise(() =>
          expect
            .poll(
              () => demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.dataset.state,
              { timeout: 10000 },
            )
            .toBe("ready"),
        );
        expect(demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.toDataURL()).not.toBe(
          original,
        );
        const downloaded = Promise.withResolvers<Response>();
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observe = () => {
              const link = page.querySelector<HTMLAnchorElement>("a[download]");
              if (link !== null) void fetch(link.href).then(downloaded.resolve, downloaded.reject);
            };
            page.addEventListener("click", observe);
            return observe;
          }),
          (observe) => Effect.sync(() => page.removeEventListener("click", observe)),
        );
        const download = demo.querySelector<HTMLButtonElement>("#home-auto-download");
        if (download === null) expect.fail("The stamped example must be downloadable");
        download.click();
        const artifact = yield* Effect.promise(() => downloaded.promise);
        const bytes = new Uint8Array(yield* Effect.promise(() => artifact.arrayBuffer()));
        const pages = yield* inspectPdf(bytes);
        expect(pages.map((page) => page.text).join("\n")).toContain("CMS");
        expect(new TextDecoder("latin1").decode(bytes)).not.toContain("/ByteRange");
        yield* Effect.promise(() => expect(fetch(artifact.url)).rejects.toBeDefined());
        const reset = demo.querySelector<HTMLButtonElement>("#home-auto-reset");
        if (reset === null) expect.fail("The demonstration must restore its original documents");
        reset.click();
        yield* Effect.promise(() =>
          expect.poll(() => demo.querySelectorAll('[data-demo-state="ready"]').length).toBe(4),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.dataset.state,
              { timeout: 10000 },
            )
            .toBe("ready"),
        );
        expect(demo.querySelector<HTMLCanvasElement>("#home-auto-preview")?.toDataURL()).toBe(
          original,
        );
      }),
    ),
    { signal },
  );
}, 45000);
