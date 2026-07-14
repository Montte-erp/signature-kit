import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/posthog/client", () => ({
  captureDocsEvent: () => {},
  initDocsPostHog: () => {},
}));

vi.mock("@/lib/client-messages", () => ({
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

const mountedRoots = new Set<Root>();

const render = (element: React.ReactElement): { container: HTMLDivElement; root: Root } => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => {
    root.render(element);
  });
  mountedRoots.add(root);

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
  for (const root of mountedRoots) root.unmount();
  mountedRoots.clear();
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

      await React.act(async () => {
        button.click();
        await flushCopy();
      });
      await flushCopy();
      expect(button.getAttribute("aria-label")).toBe("Copied");
      expect(vi.getTimerCount()).toBe(1);

      await React.act(async () => {
        button.click();
        await flushCopy();
      });
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
      <ProviderCarousel
        items={providerItems}
        panels={[<span key="panel">Panel</span>]}
        locale="en-US"
      />,
    );

    try {
      await flushCopy();
      vi.runOnlyPendingTimers();
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]');
      expect(button).toBeDefined();
      if (button === null) return;

      await React.act(async () => {
        button.click();
        await flushCopy();
      });
      await flushCopy();
      expect(button.getAttribute("aria-label")).toBe("Copied");
      expect(vi.getTimerCount()).toBe(1);

      await React.act(async () => {
        button.click();
        await flushCopy();
      });
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
      <ProviderCarousel
        items={providerItems}
        panels={[<span key="panel">Panel</span>]}
        locale="en-US"
      />,
    );
    try {
      await flushCopy();
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]');
      expect(button).toBeDefined();
      if (button === null) return;

      React.act(() => button.click());
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

  it("uses native tabs semantics with roving focus for provider panels", async () => {
    vi.useRealTimers();
    const items: ProviderCarouselItem[] = [
      ...providerItems,
      {
        name: "B2",
        filename: "b2.ts",
        logo: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP",
        code: "signWithB2()",
      },
      {
        name: "C3",
        filename: "c3.ts",
        logo: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP",
        code: "signWithC3()",
      },
    ];
    const { container } = render(
      <ProviderCarousel
        items={items}
        locale="en-US"
        panels={[
          <span key="a-panel">Panel A</span>,
          <span key="b-panel">Panel B</span>,
          <span key="c-panel">Panel C</span>,
        ]}
      />,
    );

    await flushCopy();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await flushCopy();
    const tablist = container.querySelector('[role="tablist"]');
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const panels = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    expect(tablist).not.toBeNull();
    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(panels[0]?.getAttribute("data-state")).toBe("active");
    expect(panels[1]?.getAttribute("data-state")).toBe("inactive");
    expect(panels[2]?.getAttribute("data-state")).toBe("inactive");
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(false);
    expect(panels[2]?.hidden).toBe(false);

    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId).not.toBeNull();
      const panel = panelId === null ? null : container.querySelector(`#${panelId}`);
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    React.act(() => {
      tabs[0]?.focus();
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    await flushCopy();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    expect(container.textContent).toContain("Panel A");
    expect(container.textContent).toContain("Panel B");
    expect(container.textContent).toContain("Panel C");
    expect(panels[0]?.getAttribute("data-state")).toBe("inactive");
    expect(panels[1]?.getAttribute("data-state")).toBe("active");
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(false);
    expect(tabs[0]?.getAttribute("tabindex")).toBe("-1");
    expect(tabs[1]?.getAttribute("tabindex")).toBe("0");

    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="Previous"]');
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next"]');
    expect(previous?.className).toContain("size-11");
    expect(next?.className).toContain("size-11");
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
