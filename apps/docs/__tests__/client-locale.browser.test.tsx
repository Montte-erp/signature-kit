import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/posthog/client", () => ({
  captureDocsEvent: () => {},
  initDocsPostHog: () => {},
}));

import { InstallCommand } from "../components/install-command";
import { LocaleProvider } from "../components/locale-provider";

const waitForLabel = async (button: HTMLButtonElement, label: string): Promise<void> => {
  for (let frame = 0; frame < 60; frame += 1) {
    if (button.getAttribute("aria-label") === label) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  expect(button.getAttribute("aria-label")).toBe(label);
};

let activeRoot: Root | undefined;
let previousLang = "";

afterEach(() => {
  activeRoot?.unmount();
  activeRoot = undefined;
  document.body.replaceChildren();
  document.documentElement.lang = previousLang;
});

describe("client locale channel", () => {
  it("keeps one hydrated island localized while the provider locale changes", async () => {
    previousLang = document.documentElement.lang;
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeRoot = createRoot(container);

    activeRoot.render(
      <LocaleProvider locale="pt-BR">
        <InstallCommand command="bun add package" />
      </LocaleProvider>,
    );

    const button = await new Promise<HTMLButtonElement>((resolve) => {
      const findButton = () => {
        const nextButton = container.querySelector<HTMLButtonElement>("button");
        if (nextButton !== null) {
          resolve(nextButton);
          return;
        }
        window.requestAnimationFrame(findButton);
      };
      findButton();
    });

    expect(document.documentElement.lang).toBe("pt-BR");
    await waitForLabel(button, "Copiar comando de instalação");

    activeRoot.render(
      <LocaleProvider locale="en-US">
        <InstallCommand command="bun add package" />
      </LocaleProvider>,
    );

    await waitForLabel(button, "Copy install command");
    expect(document.documentElement.lang).toBe("en-US");
  });
});
