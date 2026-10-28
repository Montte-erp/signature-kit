import type { SiteLocale } from "../lib/site-route.ts";
import { inspectPdf } from "./pdf-inspection.browser.ts";
import { Effect } from "effect";
import { expect, it } from "vitest";

const openDemonstration = Effect.fn(function* (locale: typeof SiteLocale.Type = "pt-BR") {
  const frame = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("iframe");
      element.src = `/${locale}`;
      element.style.width = "1000px";
      element.style.height = "700px";
      document.body.append(element);
      return element;
    }),
    (element) => Effect.sync(() => element.remove()),
  );
  yield* Effect.promise(() =>
    expect
      .poll(() => frame.contentDocument?.querySelector<HTMLSelectElement>("#site-theme")?.disabled)
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
  return { frame, page, demo };
});

it("prepares four real demonstration PDFs when their native section becomes visible", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { demo } = yield* openDemonstration();
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
        const { page, demo } = yield* openDemonstration();
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
        const first = demo.querySelector<HTMLButtonElement>('[role="tab"]');
        if (first === null) expect.fail("The first document must remain selectable");
        first.click();
        yield* Effect.promise(() =>
          expect.poll(() => first.getAttribute("aria-selected")).toBe("true"),
        );
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

it("navigates its linked document panels with the keyboard and previous/next controls", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { page, demo } = yield* openDemonstration("en-US");
        expect(demo.querySelector('[role="tablist"]')?.getAttribute("aria-orientation")).toBe(
          "vertical",
        );
        const tabs = [...demo.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        expect(tabs).toHaveLength(4);
        for (const tab of tabs) {
          const panelId = tab.getAttribute("aria-controls");
          if (panelId === null) expect.fail("Every example tab must identify its document panel");
          const panel = page.getElementById(panelId);
          expect(panel?.getAttribute("role")).toBe("tabpanel");
          expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
        }
        const first = tabs.at(0);
        const second = tabs.at(1);
        const last = tabs.at(-1);
        if (first === undefined || second === undefined || last === undefined)
          expect.fail("The four document tabs must be available");
        first.focus();
        first.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
        yield* Effect.promise(() =>
          expect.poll(() => second.getAttribute("aria-selected")).toBe("true"),
        );
        expect(page.activeElement).toBe(second);
        second.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
        );
        yield* Effect.promise(() =>
          expect.poll(() => last.getAttribute("aria-selected")).toBe("true"),
        );
        expect(page.activeElement).toBe(last);
        last.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
        );
        yield* Effect.promise(() =>
          expect.poll(() => first.getAttribute("aria-selected")).toBe("true"),
        );
        const next = demo.querySelector<HTMLButtonElement>("#home-auto-next");
        const previous = demo.querySelector<HTMLButtonElement>("#home-auto-previous");
        if (next === null || previous === null)
          expect.fail("Both document navigation controls must be available");
        next.click();
        yield* Effect.promise(() =>
          expect.poll(() => second.getAttribute("aria-selected")).toBe("true"),
        );
        previous.click();
        yield* Effect.promise(() =>
          expect.poll(() => first.getAttribute("aria-selected")).toBe("true"),
        );
      }),
    ),
    { signal },
  );
}, 45000);
