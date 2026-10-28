import { Context, Effect, Layer } from "effect";
import { render } from "takumi-js";
import type { Node } from "takumi-js";

import type { ContentPage } from "./config.ts";

export class SocialImages extends Context.Service<
  SocialImages,
  { readonly render: (page: ContentPage) => Effect.Effect<Uint8Array> }
>()("@signature-kit/docs/SocialImages") {}

export const socialImagesLayer = Layer.succeed(SocialImages, {
  render: Effect.fn(function* (page) {
    const node: Node = {
      type: "container",
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
        { type: "text", text: page.title, style: { fontSize: "72px", fontWeight: 800 } },
        ...(page.description === undefined
          ? []
          : [
              {
                type: "text",
                text: page.description,
                style: {
                  borderBottom: "10px dashed rgba(255, 150, 255, 0.3)",
                  color: "rgba(240, 240, 240, 0.8)",
                  fontSize: "42px",
                  marginTop: "16px",
                  paddingBottom: "28px",
                },
              } satisfies Node,
            ]),
        {
          type: "text",
          text: "SignatureKit",
          style: {
            color: "rgb(255, 150, 255)",
            fontSize: "48px",
            fontWeight: 600,
            marginTop: "auto",
          },
        },
      ],
    };
    return yield* Effect.promise((signal) =>
      render(node, { width: 1200, height: 630, format: "webp", emoji: "from-font", signal }),
    );
  }),
});
