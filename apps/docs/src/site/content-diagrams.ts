import { Context, Effect, Layer, Schema } from "effect";

export const DiagramTheme = Schema.Literals(["light", "dark"]);

export class ContentDiagrams extends Context.Service<
  ContentDiagrams,
  { readonly render: (root: Element, theme: typeof DiagramTheme.Type) => Effect.Effect<void> }
>()("@signature-kit/docs/ContentDiagrams") {}

export const contentDiagramsBrowserLayer = Layer.effect(
  ContentDiagrams,
  Effect.gen(function* () {
    const loadSdk = yield* Effect.cached(Effect.promise(() => import("mermaid")));
    return ContentDiagrams.of({
      render: Effect.fn(function* (root, theme) {
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
            Effect.gen(function* () {
              const parent = source.matches("figure.content-diagram")
                ? source
                : source.parentElement;
              if (parent === null) return;
              const text = source.dataset.diagramSource ?? source.textContent ?? "";
              const id = "content-diagram-" + crypto.randomUUID();
              const result = yield* Effect.promise(() => mermaid.render(id, text));
              yield* Effect.sync(() => {
                if (!root.isConnected) return;
                const figure = document.createElement("figure");
                figure.className = "content-diagram";
                figure.dataset.diagramSource = text;
                figure.dataset.diagramTheme = theme;
                figure.innerHTML = result.svg;
                parent.replaceWith(figure);
                result.bindFunctions?.(figure);
              });
            }),
          { discard: true },
        );
      }),
    });
  }),
);
