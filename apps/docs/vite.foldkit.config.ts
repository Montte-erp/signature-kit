import { Effect, Layer } from "effect";
import { join } from "node:path";
import { defineConfig } from "vite";
import { appRoot, siteViteConfig } from "./scripts/site-vite.ts";
import { loadSiteContent } from "./src/content/load.ts";
import { contentHighlighterLayer } from "./src/content/highlight.ts";
import { socialImagesLayer } from "./src/content/social.ts";

export default defineConfig(async ({ command }) => {
  const siteUrl = "https://signaturekit.dev";
  const content = await Effect.runPromise(
    loadSiteContent(siteUrl).pipe(
      Effect.provide(Layer.merge(contentHighlighterLayer, socialImagesLayer)),
    ),
  );
  return siteViteConfig(content, join(appRoot, "dist"), siteUrl, command === "build");
});
