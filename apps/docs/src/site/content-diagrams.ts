import { Context, Effect, Layer } from "effect";

export class ContentDiagrams extends Context.Service<
  ContentDiagrams,
  { readonly render: (root: Element) => Effect.Effect<void> }
>()("@signature-kit/docs/ContentDiagrams") {}

export const contentDiagramsBrowserLayer = Layer.effect(
  ContentDiagrams,
  Effect.gen(function* () {
    const loadSdk = yield* Effect.cached(Effect.promise(() => import("mermaid")));
    return ContentDiagrams.of({
      render: Effect.fn(function* (root) {
        const sources = [...root.querySelectorAll("code.language-mermaid")];
        if (sources.length === 0) return;
        const { default: mermaid } = yield* loadSdk;
        yield* Effect.sync(() =>
          mermaid.initialize({
            securityLevel: "strict",
            startOnLoad: false,
            theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
            themeVariables: { fontFamily: "'Inter Variable', system-ui, sans-serif" },
          }),
        );
        yield* Effect.forEach(
          sources,
          (source) =>
            Effect.gen(function* () {
              const parent = source.parentElement;
              if (parent === null) return;
              const id = "content-diagram-" + crypto.randomUUID();
              const result = yield* Effect.promise(() =>
                mermaid.render(id, source.textContent ?? ""),
              );
              yield* Effect.sync(() => {
                if (!root.isConnected) return;
                const figure = document.createElement("figure");
                figure.className = "content-diagram";
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
