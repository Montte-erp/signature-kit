import { Effect, Schema } from "effect";
import * as Server from "foldkit/experimental/server";
import { parseContent, renderContent, resolveContent } from "./content";
import type { Locale } from "./content";
import { Flags, init } from "./main";
import type { Model } from "./main";
import { Runtime } from "foldkit";
import { expect, it, onTestFinished } from "vitest";
import { mermaidView } from "./mermaid";

const mount = (source: string) => {
  const host = document.createElement("div");
  const container = document.createElement("div");
  container.id = `mermaid-test-${crypto.randomUUID()}`;
  host.append(container);
  document.body.append(host);
  onTestFinished(() => host.remove());
  const handle = Runtime.embed(
    Runtime.makeElement({
      Model: Schema.Struct({}),
      init: () => ({ model: {} }),
      update: (model) => ({ model }),
      view: (_model, h) => mermaidView(h, source),
      container,
    }),
  );
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      handle.dispose();
      host.remove();
    }
  };
  onTestFinished(dispose);
  return { container: host, dispose };
};

it("renders a real SVG with labels and releases its mount", async () => {
  const app = mount("flowchart LR\n A[First label] --> B[Second label]");
  await expect
    .poll(() => app.container.querySelector('[data-mermaid-state="ready"][aria-busy="false"]'), {
      timeout: 15_000,
    })
    .not.toBeNull();
  expect(app.container.querySelector("[data-mermaid-output] svg")?.textContent).toContain(
    "Second label",
  );
  expect(app.container.querySelector("[data-mermaid-output] svg")?.textContent).toContain(
    "First label",
  );
  expect(app.container.querySelector("[data-mermaid-fallback]")).toBeNull();
  expect(
    app.container.querySelector('[data-mermaid-state="ready"][aria-busy="false"]'),
  ).not.toBeNull();
  expect(app.container.querySelector("[data-mermaid-workspace]")).toBeNull();
  app.dispose();
}, 20_000);

it("keeps source for invalid syntax without an unhandled rejection", async () => {
  const errors: unknown[] = [];
  const listener = (event: PromiseRejectionEvent) => {
    errors.push(event.reason);
  };
  window.addEventListener("unhandledrejection", listener);
  onTestFinished(() => window.removeEventListener("unhandledrejection", listener));
  const app = mount("flowchart LR\n A --> --> B");
  await expect
    .poll(() => app.container.querySelector('[data-mermaid-state="error"][aria-busy="false"]'), {
      timeout: 15_000,
    })
    .not.toBeNull();
  expect(app.container.querySelector("[data-mermaid-fallback]")?.textContent).toContain(
    "A --> --> B",
  );
  expect(app.container.querySelector("[data-mermaid-workspace]")).toBeNull();
  expect(app.container.querySelector("svg")).toBeNull();
  expect(errors).toEqual([]);
  app.dispose();
  window.removeEventListener("unhandledrejection", listener);
}, 20_000);

it("renders localized SSR card grids with individual direct children", async () => {
  for (const locale of ["en-US", "pt-BR"] satisfies Locale[]) {
    const page = resolveContent(locale, "docs", "");
    expect(page).toBeDefined();
    if (page === undefined) continue;
    const result = await Effect.runPromise(
      Server.renderToString<Model, never, typeof Flags.Type>(
        {
          Flags,
          init,
          view: (_model, h) => ({
            title: page.title,
            body: h.main([], renderContent(page.nodes, h)),
          }),
        },
        { flags: { locale, path: "/docs" }, isHydratable: false },
      ),
    );
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    const grids = doc.querySelectorAll(".cards");
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(grid.parentElement?.tagName).not.toBe("P");
      expect(grid.children).toHaveLength(4);
      expect(
        [...grid.children].every(
          (child) => child.classList.contains("card") && child.tagName === "A",
        ),
      ).toBe(true);
    }
  }
});

it("preserves inline content around a card grid", async () => {
  const page = parseContent(
    '---\ntitle: Example\n---\n\nBefore <Cards><Card title="One" href="/one" /><Card title="Two" href="/two" /></Cards> after *text*.',
  );
  const result = await Effect.runPromise(
    Server.renderToString<Model, never, typeof Flags.Type>(
      {
        Flags,
        init,
        view: (_model, h) => ({
          title: page.title,
          body: h.main([], renderContent(page.nodes, h)),
        }),
      },
      { flags: { locale: "en-US", path: "/docs" }, isHydratable: false },
    ),
  );
  const doc = new DOMParser().parseFromString(result.html, "text/html");
  const grid = doc.querySelector(".cards");
  expect(grid?.children).toHaveLength(2);
  expect(grid?.previousElementSibling?.textContent).toContain("Before");
  expect(grid?.nextElementSibling?.textContent).toContain("after text.");
  expect(grid?.nextElementSibling?.querySelector("em")?.textContent).toBe("text");
});
