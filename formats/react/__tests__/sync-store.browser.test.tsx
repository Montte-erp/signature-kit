import * as React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncStore, useSyncStore } from "../src/sync-store";

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 300): Promise<void> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

if (typeof document === "undefined") {
  describe.skip("useSyncStore selector snapshots", () => {
    it("runs only through browser integration command", () => {});
  });
} else {
  describe("useSyncStore selector snapshots", () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
      if (root !== null) {
        root.unmount();
        root = null;
      }
      if (container !== null) {
        container.remove();
        container = null;
      }
      vi.restoreAllMocks();
    });

    it("renders a fresh-object selector without an uncached getSnapshot warning", async () => {
      const store = createSyncStore({ count: 0 });
      const observed: number[] = [];
      let renders = 0;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      container = document.createElement("div");
      root = createRoot(container);

      const Probe = () => {
        const selected = useSyncStore(store, (state) => ({ count: state.count }));
        renders += 1;

        React.useLayoutEffect(() => {
          observed.push(selected.count);
        }, [selected.count]);

        return null;
      };

      root.render(<Probe />);
      await waitFor(() => observed.at(-1) === 0, "initial selector result");

      store.setState((state) => ({ count: state.count + 1 }));
      await waitFor(() => observed.at(-1) === 1, "updated selector result");
      await rafTick();

      const errors = consoleError.mock.calls
        .map((arguments_) => arguments_.map((argument) => String(argument)).join(" "))
        .join("\n");
      expect(errors).not.toContain("getSnapshot");
      expect(renders).toBeLessThanOrEqual(3);
    });
  });
}
