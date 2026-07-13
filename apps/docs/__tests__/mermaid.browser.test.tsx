import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

import { Mermaid } from "../components/mermaid";

const render = (element: React.ReactElement): { container: HTMLDivElement; root: Root } => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(element);
  return { container, root };
};

const waitForFrames = async (predicate: () => boolean): Promise<void> => {
  for (let frame = 0; frame < 120; frame += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  throw new Error("Timed out waiting for Mermaid render");
};

if (typeof document === "undefined") {
  describe.skip("Mermaid rendering (browser)", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("Mermaid rendering", () => {
    beforeEach(() => {
      mermaidMock.initialize.mockReset();
      mermaidMock.render.mockReset();
      document.body.replaceChildren();
    });

    it("loads the runtime on hydration and renders an SVG", async () => {
      mermaidMock.render.mockResolvedValue({ svg: '<svg data-testid="diagram-svg"></svg>' });
      const { container, root } = render(<Mermaid chart="flowchart TD\n  A-->B" />);

      try {
        await waitForFrames(() => container.querySelector('[data-testid="diagram-svg"]') !== null);
        expect(mermaidMock.initialize).toHaveBeenCalledWith(
          expect.objectContaining({
            securityLevel: "strict",
            startOnLoad: false,
            theme: "default",
          }),
        );
        expect(mermaidMock.render).toHaveBeenCalledOnce();
        expect(container.querySelector('[data-testid="diagram-svg"]')).not.toBeNull();
      } finally {
        root.unmount();
        container.remove();
      }
    });

    it("renders a fallback when the runtime rejects without an unhandled rejection", async () => {
      mermaidMock.render.mockRejectedValue(new Error("parser failed"));
      const unhandledRejections: Array<unknown> = [];
      const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
        event.preventDefault();
        unhandledRejections.push(event.reason);
      };
      window.addEventListener("unhandledrejection", onUnhandledRejection);
      const { container, root } = render(<Mermaid chart="invalid chart" />);

      try {
        await waitForFrames(
          () => container.textContent?.includes("Unable to render Mermaid diagram.") ?? false,
        );
        await Promise.resolve();
        expect(unhandledRejections).toEqual([]);
        expect(container.textContent).toContain("Unable to render Mermaid diagram.");
      } finally {
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
        root.unmount();
        container.remove();
      }
    });
  });
}
