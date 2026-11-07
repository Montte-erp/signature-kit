import { Effect } from "effect";
import { Runtime } from "foldkit";
import * as Server from "foldkit/experimental/server";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Flags, Model, init, update, view } from "./main";

it("navigates with the keyboard and releases each instance's PDF URLs independently", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("div");
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        const create = (id: string) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const wrapper = document.createElement("div");
              const container = document.createElement("div");
              container.id = id;
              wrapper.append(container);
              host.append(wrapper);
              const handle = Runtime.embed(
                Runtime.makeApplication({ Flags, Model, init, update, view, container }),
                {
                  flags: Effect.succeed(Flags.make({ locale: "en-US", path: "" })),
                },
              );
              return { container: wrapper, handle };
            }),
            ({ handle }) => Effect.sync(() => handle.dispose()),
          );
        const first = yield* create("demo-keyboard-one");
        const second = yield* create("demo-keyboard-two");
        yield* Effect.promise(() =>
          expect
            .poll(
              () => first.container.querySelector<HTMLAnchorElement>("[data-demo-download]")?.href,
              { timeout: 30000 },
            )
            .toMatch(/^blob:/),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => second.container.querySelector<HTMLAnchorElement>("[data-demo-download]")?.href,
              { timeout: 30000 },
            )
            .toMatch(/^blob:/),
        );
        const firstUrl =
          first.container.querySelector<HTMLAnchorElement>("[data-demo-download]")?.href;
        const secondUrl =
          second.container.querySelector<HTMLAnchorElement>("[data-demo-download]")?.href;
        const next = first.container.querySelector<HTMLButtonElement>("[data-demo-next]");
        if (next === null || firstUrl === undefined || secondUrl === undefined)
          return expect.fail("Demo controls missing");
        next.focus();
        yield* Effect.promise(() => userEvent.keyboard("{Enter}"));
        yield* Effect.promise(() =>
          expect
            .poll(() => first.container.querySelector("[data-demo-label]")?.textContent)
            .toContain("2 / 4"),
        );
        expect(
          first.container.querySelector('[data-demo-index="1"]')?.getAttribute("aria-pressed"),
        ).toBe("true");
        expect(second.container.querySelector("[data-demo-label]")?.textContent).toContain("1 / 4");
        first.handle.dispose();
        yield* Effect.promise(() =>
          expect
            .poll(() =>
              fetch(firstUrl).then(
                () => false,
                () => true,
              ),
            )
            .toBe(true),
        );
        expect((yield* Effect.promise(() => fetch(secondUrl))).ok).toBe(true);
      }),
    ),
  );
}, 60000);

it("hydrates the server-rendered demo and runs its controls", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const rendered = yield* Server.renderToString(
          { Flags, init, view },
          {
            flags: { locale: "en-US", path: "" },
            buildId: "home-demo-hydration",
          },
        );
        expect(rendered.html).toContain("data-demo-next");
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        const mainUrl = new URL("./main.ts", import.meta.url).href;
        const loaded = new Promise<void>((resolve) =>
          frame.addEventListener("load", () => resolve(), { once: true }),
        );
        frame.srcdoc = `<!doctype html><html><body>${rendered.html}<script type="module">
      import { Runtime } from "/@id/foldkit";
      import { Flags, Model, init, update, view } from ${JSON.stringify(mainUrl)};
      const container = document.querySelector("[data-foldkit-app]");
      Runtime.hydrate(Runtime.makeApplication({ Flags, Model, init, update, view, container }), { buildId: "home-demo-hydration" });
    </script></body></html>`;
        yield* Effect.promise(() => loaded);
        const doc = frame.contentDocument;
        if (doc === null) return expect.fail("Hydration document missing");
        yield* Effect.promise(() =>
          expect
            .poll(() => doc.querySelector<HTMLAnchorElement>("[data-demo-download]")?.href, {
              timeout: 30000,
            })
            .toMatch(/^blob:/),
        );
        const next = doc.querySelector<HTMLButtonElement>("[data-demo-next]");
        if (next === null) return expect.fail("SSR demo missing");
        next.click();
        yield* Effect.promise(() =>
          expect.poll(() => doc.querySelector("[data-demo-label]")?.textContent).toContain("2 / 4"),
        );
      }),
    ),
  );
}, 60000);
