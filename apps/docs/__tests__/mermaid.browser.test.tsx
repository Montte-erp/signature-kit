import * as React from "react";
import { createRoot } from "react-dom/client";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Mermaid } from "../components/mermaid";

const mount = (chart: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      root.render(<Mermaid chart={chart} />);
      return { container, root };
    }),
    ({ container, root }) =>
      Effect.sync(() => {
        root.unmount();
        container.remove();
      }),
  );

describe("Mermaid rendering", () => {
  it(
    "loads the real runtime and renders the diagram labels in an SVG",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { container } = yield* mount("flowchart TD\n  A[Certificate]-->B[Signature]");
          yield* Effect.promise(() =>
            expect.poll(() => container.querySelector("svg"), { timeout: 15000 }).not.toBeNull(),
          );
          expect(container.querySelector("svg")?.textContent).toContain("Certificate");
          expect(container.querySelector("svg")?.textContent).toContain("Signature");
        }).pipe(Effect.scoped),
      ),
    20000,
  );

  it(
    "shows a fallback for invalid syntax without an unhandled rejection",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const unhandledRejections: unknown[] = [];
          const listener = (event: PromiseRejectionEvent): void => {
            unhandledRejections.push(event.reason);
          };
          yield* Effect.acquireRelease(
            Effect.sync(() => window.addEventListener("unhandledrejection", listener)),
            () => Effect.sync(() => window.removeEventListener("unhandledrejection", listener)),
          );
          const { container } = yield* mount("invalid chart");
          yield* Effect.promise(() =>
            expect
              .poll(() => container.textContent, { timeout: 15000 })
              .toContain("Unable to render Mermaid diagram."),
          );
          expect(unhandledRejections).toEqual([]);
        }).pipe(Effect.scoped),
      ),
    20000,
  );
});
