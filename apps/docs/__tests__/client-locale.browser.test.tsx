import * as React from "react";
import { createRoot } from "react-dom/client";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { InstallCommand } from "../components/install-command";
import { LocaleProvider } from "../components/locale-provider";

describe("client locale channel", () => {
  it("keeps one hydrated island localized while the provider locale changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { container, root } = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const previousLang = document.documentElement.lang;
            const container = document.createElement("div");
            document.body.appendChild(container);
            return { container, root: createRoot(container), previousLang };
          }),
          ({ container, root, previousLang }) =>
            Effect.sync(() => {
              root.unmount();
              container.remove();
              document.documentElement.lang = previousLang;
            }),
        );
        root.render(
          <LocaleProvider locale="pt-BR">
            <InstallCommand command="bun add package" />
          </LocaleProvider>,
        );
        yield* Effect.promise(() =>
          expect
            .poll(() => container.querySelector("button")?.getAttribute("aria-label"))
            .toBe("Copiar comando de instalação"),
        );
        expect(document.documentElement.lang).toBe("pt-BR");
        const button = container.querySelector("button");
        root.render(
          <LocaleProvider locale="en-US">
            <InstallCommand command="bun add package" />
          </LocaleProvider>,
        );
        yield* Effect.promise(() =>
          expect.poll(() => button?.getAttribute("aria-label")).toBe("Copy install command"),
        );
        expect(container.querySelector("button")).toBe(button);
        expect(document.documentElement.lang).toBe("en-US");
      }).pipe(Effect.scoped),
    ));
});
