import { Context, Effect, Layer, Schema } from "effect";
import type { SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";

export const DiagramTheme = Schema.Literals(["light", "dark"]);

export class ContentDiagrams extends Context.Service<
  ContentDiagrams,
  {
    readonly render: (
      root: Element,
      theme: typeof DiagramTheme.Type,
      locale: typeof SiteLocale.Type,
    ) => Effect.Effect<void>;
  }
>()("@signature-kit/docs/ContentDiagrams") {}

export const contentDiagramsBrowserLayer = Layer.effect(
  ContentDiagrams,
  Effect.gen(function* () {
    const loadSdk = yield* Effect.cached(Effect.promise(() => import("mermaid")));
    return ContentDiagrams.of({
      render: Effect.fn(function* (root, theme, locale) {
        const sources = [
          ...root.querySelectorAll<HTMLElement>(
            "code.language-mermaid, figure.content-diagram[data-diagram-source]",
          ),
        ];
        if (sources.length === 0) return;
        const { default: mermaid } = yield* loadSdk;
        yield* Effect.sync(() =>
          mermaid.initialize({
            securityLevel: "strict",
            startOnLoad: false,
            theme: theme === "dark" ? "dark" : "default",
            themeVariables: { fontFamily: "'Inter Variable', system-ui, sans-serif" },
          }),
        );
        yield* Effect.forEach(
          sources,
          (source) =>
            Effect.scoped(
              Effect.gen(function* () {
                const parent = source.matches("figure.content-diagram")
                  ? source
                  : source.parentElement;
                if (parent === null) return;
                const text = source.dataset.diagramSource ?? source.textContent ?? "";
                const parsed = yield* Effect.promise(() =>
                  mermaid.parse(text, { suppressErrors: true }),
                );
                const figure = yield* Effect.sync(() => {
                  const element = document.createElement("figure");
                  element.className = "content-diagram";
                  element.dataset.diagramSource = text;
                  element.dataset.diagramTheme = theme;
                  return element;
                });
                if (parsed === false) {
                  yield* Effect.sync(() => {
                    if (!root.isConnected) return;
                    figure.dataset.diagramState = "failed";
                    const caption = document.createElement("figcaption");
                    caption.textContent = m.site_diagram_fallback({}, { locale });
                    const pre = document.createElement("pre");
                    const code = document.createElement("code");
                    code.textContent = text;
                    pre.append(code);
                    figure.append(caption, pre);
                    parent.replaceWith(figure);
                  });
                  return;
                }
                const container = yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    const element = document.createElement("div");
                    element.style.position = "absolute";
                    element.style.visibility = "hidden";
                    element.style.width = `${root.getBoundingClientRect().width}px`;
                    root.ownerDocument.body.append(element);
                    return element;
                  }),
                  (element) => Effect.sync(() => element.remove()),
                );
                const id = "content-diagram-" + crypto.randomUUID();
                const result = yield* Effect.promise(() => mermaid.render(id, text, container));
                yield* Effect.sync(() => {
                  if (!root.isConnected) return;
                  figure.dataset.diagramState = "ready";
                  figure.innerHTML = result.svg;
                  parent.replaceWith(figure);
                  result.bindFunctions?.(figure);
                });
              }),
            ),
          { discard: true },
        );
      }),
    });
  }),
);
