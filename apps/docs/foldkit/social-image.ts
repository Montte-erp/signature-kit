import { Context, Effect, Layer, Schema } from "effect";
import { Renderer } from "takumi-js/node";
import type { Node } from "takumi-js/node";

export const SocialImageInput = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  site: Schema.String,
  locale: Schema.Literals(["en-US", "pt-BR"]),
});
export type SocialImageInput = typeof SocialImageInput.Type;

export const socialImageTree = (input: SocialImageInput): Node => ({
  type: "container",
  lang: input.locale,
  style: {
    backgroundColor: "#0c0c0c",
    color: "#ffffff",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    padding: "64px",
    width: "100%",
  },
  children: [
    { type: "text", text: input.title, style: { fontSize: "72px", fontWeight: 800 } },
    ...(input.description !== undefined && input.description.length > 0
      ? [
          {
            type: "text",
            text: input.description,
            style: {
              borderBottom: "10px dashed rgba(255, 150, 255, 0.3)",
              color: "rgba(240, 240, 240, 0.8)",
              fontSize: "42px",
              marginTop: "16px",
              paddingBottom: "28px",
            },
          } satisfies Node,
        ]
      : []),
    {
      type: "text",
      text: input.site,
      style: { color: "rgb(255, 150, 255)", fontSize: "48px", fontWeight: 600, marginTop: "auto" },
    },
  ],
});

export class SocialImage extends Context.Service<
  SocialImage,
  {
    readonly render: (input: unknown) => Effect.Effect<Uint8Array, Schema.SchemaError>;
  }
>()("docs/SocialImage") {}

export const socialImageLayer = Layer.sync(SocialImage, () => {
  const renderer = new Renderer();
  return SocialImage.of({
    render: Effect.fn(function* (input: unknown) {
      const data = yield* Schema.decodeUnknownEffect(SocialImageInput)(input);
      return yield* Effect.promise((signal) =>
        renderer.render(socialImageTree(data), {
          width: 1200,
          height: 630,
          format: "webp",
          signal,
        }),
      );
    }),
  });
});
