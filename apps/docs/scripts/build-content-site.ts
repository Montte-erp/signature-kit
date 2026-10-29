import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { createBuilder } from "vite";
import { FoldkitBuildMetadata } from "@foldkit/vite-plugin";
import { loadSiteContent } from "../src/content/load.ts";
import { socialImagesLayer } from "../src/content/social.ts";
import { contentHighlighterLayer } from "../src/content/highlight.ts";
import { appRoot, siteViteConfig } from "./site-vite.ts";

const ContentSiteBuildOptions = Schema.Struct({
  outputDir: Schema.NonEmptyString,
  siteUrl: Schema.NonEmptyString,
});

export const buildContentSite = Effect.fn(function* (options: typeof ContentSiteBuildOptions.Type) {
  const content = yield* loadSiteContent(options.siteUrl);
  const builder = yield* Effect.promise(() =>
    createBuilder({
      ...siteViteConfig(content, options.outputDir, options.siteUrl, true),
      configFile: false,
    }),
  );
  yield* Effect.promise(() => builder.buildApp());
  const plugin = builder.config.plugins.find((candidate) => candidate.name === "foldkit:build");
  return yield* Schema.decodeUnknownEffect(FoldkitBuildMetadata)(plugin?.api.getBuildMetadata());
});

if (import.meta.main) {
  const result = await Effect.runPromise(
    buildContentSite({
      outputDir: process.argv[2] ?? join(appRoot, "dist"),
      siteUrl: "https://signaturekit.dev",
    }).pipe(Effect.provide(Layer.merge(contentHighlighterLayer, socialImagesLayer))),
  );
  console.log(
    `Published ${result.manifest.prerendered.length} Foldkit content pages to ${result.clientDirectory}`,
  );
}
