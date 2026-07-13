import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/posthog/client", () => ({
  captureDocsEvent: () => {},
  initDocsPostHog: () => {},
}));

vi.mock("@/paraglide/messages", () => ({
  m: {
    install_copied_label: () => "Copied",
    install_copy_label: () => "Copy",
    showcase_card_provider: () => "Provider",
    showcase_card_hint: () => "Choose a provider",
    showcase_prev: () => "Previous",
    showcase_next: () => "Next",
    showcase_copied: () => "Copied",
    showcase_copy: () => "Copy",
  },
}));

import { InstallCommand } from "../components/install-command";
import {
  ProviderCarousel,
  type ProviderCarouselItem,
} from "../components/sections/provider-carousel";

const flushCopy = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const render = (element: React.ReactElement): { container: HTMLDivElement; root: Root } => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(element);
  return { container, root };
};

const installClipboard = () => {
  if (navigator.clipboard === undefined) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  }

  return vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
};

const providerItems: ProviderCarouselItem[] = [
  {
    name: "A1",
    filename: "a1.ts",
    logo: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP",
    code: "signWithA1()",
  },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("copy feedback timer lifecycle", () => {
  it("cancels install feedback on re-click and unmount", async () => {
    const writeText = installClipboard();
    const { container, root } = render(<InstallCommand command="bun add package" />);

    try {
      await flushCopy();
      const button = container.querySelector<HTMLButtonElement>("button");
      expect(button).toBeDefined();
      if (button === null) return;

      button.click();
      await flushCopy();
      expect(button.getAttribute("aria-label")).toBe("Copied");
      expect(vi.getTimerCount()).toBe(1);

      button.click();
      await flushCopy();
      expect(vi.getTimerCount()).toBe(1);

      root.unmount();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1800);
      expect(container.textContent).toBe("");
    } finally {
      writeText.mockRestore();
      root.unmount();
      container.remove();
    }
  });
  it("cancels provider feedback on re-click and unmount", async () => {
    const writeText = installClipboard();
    const { container, root } = render(
      <ProviderCarousel items={providerItems} panels={[<span key="panel">Panel</span>]} />,
    );

    try {
      await flushCopy();
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]');
      expect(button).toBeDefined();
      if (button === null) return;

      button.click();
      await flushCopy();
      expect(button.getAttribute("aria-label")).toBe("Copied");
      expect(vi.getTimerCount()).toBe(1);

      button.click();
      await flushCopy();
      expect(vi.getTimerCount()).toBe(1);

      root.unmount();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1800);
      expect(container.textContent).toBe("");
    } finally {
      writeText.mockRestore();
      root.unmount();
      container.remove();
    }
  });

  it("does not schedule provider feedback after unmount", async () => {
    let resolveClipboard: (() => void) | undefined;
    const writeText = installClipboard().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClipboard = resolve;
        }),
    );
    const { container, root } = render(
      <ProviderCarousel items={providerItems} panels={[<span key="panel">Panel</span>]} />,
    );
    try {
      await flushCopy();
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]');
      expect(button).toBeDefined();
      if (button === null) return;

      button.click();
      root.unmount();
      resolveClipboard?.();
      await flushCopy();

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1800);
      expect(container.textContent).toBe("");
    } finally {
      writeText.mockRestore();
      root.unmount();
      container.remove();
    }
  });
});
