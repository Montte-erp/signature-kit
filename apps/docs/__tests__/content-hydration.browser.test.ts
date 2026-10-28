import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Http from "foldkit/http";
import { describe, expect, it } from "vitest";

describe("Foldkit production hydration", () => {
  it("adopts the generated server DOM and runs search from the production bundle", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* HttpClient.get("/pt-BR/docs/signing/certificates").pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
          );
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const previous = localStorage.getItem("theme");
              localStorage.setItem("theme", "light");
              return previous;
            }),
            (previous) =>
              Effect.sync(() => {
                if (previous === null) localStorage.removeItem("theme");
                else localStorage.setItem("theme", previous);
              }),
          );
          const source = yield* response.text;
          const parsed = new DOMParser().parseFromString(source, "text/html");
          const entry = parsed.querySelector<HTMLScriptElement>('script[type="module"][src]');
          if (entry === null) expect.fail("The production document must declare a browser entry");
          const entryUrl = entry.src;
          const frame = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const element = document.createElement("iframe");
              element.src = "/pt-BR/docs/signing/certificates?__foldkit_test_defer_entry=1";
              document.body.append(element);
              return element;
            }),
            (element) => Effect.sync(() => element.remove()),
          );
          yield* Effect.promise(() =>
            expect
              .poll(() => frame.contentDocument?.querySelector("h1")?.textContent)
              .toBe("Certificados A1"),
          );
          const page = frame.contentDocument;
          if (page === null) expect.fail("The production frame must be accessible");
          const preview = page.createElement("img");
          preview.src = "/pt-BR/docs/signing/certificates.webp";
          yield* Effect.promise(() => preview.decode());
          expect(preview.naturalWidth).toBe(1200);
          expect(preview.naturalHeight).toBe(630);
          const serverHeading = page.querySelector("h1");
          const script = page.createElement("script");
          script.type = "module";
          script.src = entryUrl;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const loaded = Promise.withResolvers<void>();
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  const onLoad = () => loaded.resolve();
                  const onError = () => loaded.reject("The production entry failed to load");
                  script.addEventListener("load", onLoad);
                  script.addEventListener("error", onError);
                  page.body.append(script);
                  return { onLoad, onError };
                }),
                (listeners) =>
                  Effect.sync(() => {
                    script.removeEventListener("load", listeners.onLoad);
                    script.removeEventListener("error", listeners.onError);
                  }),
              );
              yield* Effect.promise(() => loaded.promise);
            }),
          );
          const theme = page.querySelector<HTMLSelectElement>("#site-theme");
          if (theme === null) expect.fail("The header must expose the theme preference");
          yield* Effect.promise(() =>
            expect.poll(() => page.documentElement.dataset.theme).toBe("light"),
          );
          expect(frame.contentWindow?.getComputedStyle(page.documentElement).backgroundColor).toBe(
            "rgb(255, 255, 255)",
          );
          theme.value = "dark";
          theme.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect.poll(() => localStorage.getItem("theme")).toBe("dark"),
          );
          expect(page.documentElement.dataset.theme).toBe("dark");
          expect(frame.contentWindow?.getComputedStyle(page.documentElement).backgroundColor).toBe(
            "rgb(31, 31, 31)",
          );
          const trigger = page.querySelector<HTMLButtonElement>("#site-search-trigger");
          if (trigger === null) expect.fail("Server markup must contain the search trigger");
          trigger.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector<HTMLDialogElement>("#site-search-dialog")?.open)
              .toBe(true),
          );
          const input = page.querySelector<HTMLInputElement>("#site-search-input");
          if (input === null) expect.fail("Hydrated search must have an input");
          input.value = "numero de serie";
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  page.querySelector(
                    '#site-search-results a[href="/pt-BR/docs/signing/certificates"]',
                  )?.textContent,
              )
              .toBe("Certificados A1"),
          );
          expect(page.querySelector("h1")).toBe(serverHeading);
          expect(page.body.inert).toBe(false);
          expect(page.documentElement.lang).toBe("pt-BR");
          frame.src = "/pt-BR/docs/signing/certificates";
          yield* Effect.promise(() =>
            expect.poll(() => frame.contentDocument === page).toBe(false),
          );
          yield* Effect.promise(() =>
            expect.poll(() => frame.contentDocument?.documentElement.dataset.theme).toBe("dark"),
          );
        }),
      ).pipe(Effect.provide(Http.layer)),
    );
  });
});
