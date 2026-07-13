import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { CardTitle } from "../components/ui/card";

if (typeof document === "undefined") {
  describe.skip("CardTitle semantics (browser)", () => {
    it("runs only through the browser test config", () => {});
  });
} else {
  describe("CardTitle semantics", () => {
    it("renders card titles as level-three headings", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(<CardTitle>Capability title</CardTitle>);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

        const title = container.querySelector('[data-slot="card-title"]');
        expect(title?.tagName).toBe("H3");
        expect(title?.textContent).toBe("Capability title");
      } finally {
        root.unmount();
        container.remove();
      }
    });
  });
}
