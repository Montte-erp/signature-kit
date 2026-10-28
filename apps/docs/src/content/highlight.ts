import { Context, Effect, Layer, Schema } from "effect";
import type { ElementContent } from "hast";
import { createHighlighter } from "shiki";

export const CodeLanguage = Schema.Literals(["ts", "tsx", "bash", "text"]);

export class ContentHighlighter extends Context.Service<
  ContentHighlighter,
  {
    readonly highlight: (
      source: string,
      language: typeof CodeLanguage.Type,
    ) => Effect.Effect<ElementContent[]>;
  }
>()("@signature-kit/docs/ContentHighlighter") {}

export const contentHighlighterLayer = Layer.effect(
  ContentHighlighter,
  Effect.gen(function* () {
    const highlighter = yield* Effect.acquireRelease(
      Effect.promise(() =>
        createHighlighter({
          themes: ["vitesse-light", "vitesse-dark"],
          langs: ["ts", "tsx", "bash"],
        }),
      ),
      (resource) => Effect.sync(() => resource.dispose()),
    );
    return ContentHighlighter.of({
      highlight: Effect.fn(function* (source, language) {
        const highlighted = highlighter.codeToHast(source, {
          lang: language,
          themes: { light: "vitesse-light", dark: "vitesse-dark" },
        });
        return yield* Effect.forEach(highlighted.children, (node) =>
          node.type === "element" || node.type === "text" || node.type === "comment"
            ? Effect.succeed(node)
            : Effect.die("Code highlighting produced a non-HTML node"),
        );
      }),
    });
  }),
);
