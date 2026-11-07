import { Effect, Schema } from "effect";
import * as Mount from "foldkit/mount";
import type { HtmlBuilder } from "foldkit/html";

const MermaidMount = Mount.define("MermaidMount", {
  messages: [Schema.Never],
  execute: ({ element }) =>
    Effect.gen(function* () {
      const resource = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const workspace = document.createElement("div");
          workspace.setAttribute("data-mermaid-workspace", "");
          workspace.style.position = "absolute";
          workspace.style.visibility = "hidden";
          element.append(workspace);
          return { workspace, active: true };
        }),
        (resource) =>
          Effect.sync(() => {
            resource.active = false;
            resource.workspace.remove();
          }),
      );
      const source = element.querySelector("code")?.textContent ?? "";
      yield* Effect.promise(() =>
        import("mermaid")
          .then(async ({ default: mermaid }) => {
            if (!resource.active) return;
            element.setAttribute("data-mermaid-state", "rendering");
            element.setAttribute("aria-busy", "true");
            mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
            const result = await mermaid.render(
              `mermaid-${crypto.randomUUID()}`,
              source,
              resource.workspace,
            );
            if (resource.active) {
              const output = element.querySelector("[data-mermaid-output]");
              const fallback = element.querySelector("[data-mermaid-fallback]");
              if (output !== null && fallback !== null) {
                output.innerHTML = result.svg;
                fallback.remove();
                element.setAttribute("data-mermaid-state", "ready");
                element.setAttribute("aria-busy", "false");
              }
            }
          })
          .then(
            () => resource.workspace.remove(),
            () => {
              resource.workspace.remove();
              if (resource.active) {
                element.setAttribute("data-mermaid-state", "error");
                element.setAttribute("aria-busy", "false");
                element.setAttribute("aria-label", "Diagram could not be rendered; source follows");
              }
            },
          ),
      );
      return yield* Effect.never;
    }),
});

export const mermaidView = <Message>(
  h: HtmlBuilder<Message>,
  source: string,
  meta?: string | null,
) =>
  h.div(
    [
      h.OnMount(MermaidMount()),
      h.Attribute("data-mermaid-state", "rendering"),
      h.Attribute("aria-busy", "true"),
    ],
    [
      meta != null && meta.length > 0 ? h.p([], [meta]) : null,
      h.div([h.Attribute("data-mermaid-output", "")]),
      h.div(
        [h.Attribute("data-mermaid-fallback", "")],
        [h.pre([], [h.code([h.Class("language-mermaid")], [source])])],
      ),
    ],
  );
