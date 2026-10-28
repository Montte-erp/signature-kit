import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Layer, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { build } from "vite";

import { baseLocale, locales } from "../paraglide/runtime.js";
import { localizedSitePath } from "../lib/site-route.ts";
import {
  blogTagIndexes,
  collectionIndex,
  documentationNavigation,
} from "../src/content/catalog.ts";
import { ContentCollection, ContentMenu, SearchIndex } from "../src/content/config.ts";
import { compileContent } from "../src/content/compile.ts";
import { rssArtifacts, sitemapArtifact, textArtifacts } from "../src/content/publication.ts";
import { SocialImages, socialImagesLayer } from "../src/content/social.ts";
import { contentHighlighterLayer } from "../src/content/highlight.ts";
import { renderContentDocument } from "../src/site/document.ts";
import { homeEntry } from "../src/site/landing.ts";
import { freeSigningEntry } from "../src/site/free-signing.ts";
import { contentApplication } from "../src/site/application.ts";

const ContentSiteBuildOptions = Schema.Struct({
  outputDir: Schema.NonEmptyString,
  siteUrl: Schema.NonEmptyString,
});

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const contentRoot = join(appRoot, "content");

export const buildContentSite = Effect.fn(function* (options: typeof ContentSiteBuildOptions.Type) {
  const images = yield* SocialImages;
  const files = yield* Effect.promise(() => readdir(contentRoot, { recursive: true }));
  const sources = files.filter((file) => file.endsWith(".mdx"));
  const sourceSet = new Set(files);
  const baseSources = sources.filter(
    (file) => !locales.some((locale) => file.endsWith(`.${locale}.mdx`)),
  );
  const buildId = randomUUID();

  yield* Effect.promise(() =>
    build({
      configFile: false,
      oxc: { jsx: { development: false } },
      root: appRoot,
      define: {
        __SITE_BUILD_ID__: JSON.stringify(buildId),
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      resolve: { tsconfigPaths: true },
      logLevel: "warn",
      build: {
        outDir: options.outputDir,
        emptyOutDir: true,
        rolldownOptions: { output: { chunkFileNames: "assets/[name]-[hash].js" } },
        lib: {
          entry: join(appRoot, "src/site/client.ts"),
          formats: ["es"],
          fileName: () => "assets/content.js",
          cssFileName: "assets/content",
        },
      },
    }),
  );

  const localizedEntries = yield* Effect.forEach(locales, (locale) =>
    Effect.forEach(baseSources, (file) =>
      Effect.gen(function* () {
        const localizedFile = `${file.slice(0, -4)}.${locale}.mdx`;
        const sourceFile = sourceSet.has(localizedFile) ? localizedFile : file;
        const source = yield* Effect.promise(() => readFile(join(contentRoot, sourceFile), "utf8"));
        const { markdown, ...page } = yield* compileContent(source);
        const stem = file.slice(0, -4).split(sep).join("/");
        const path = stem.endsWith("/index") ? stem.slice(0, -6) : stem;
        return {
          locale,
          path,
          page,
          markdown,
          sourceLocale: sourceSet.has(localizedFile) ? locale : baseLocale,
          sourceUrl:
            "https://github.com/Montte-erp/signature-kit/blob/main/apps/docs/content/" +
            sourceFile.split(sep).map(encodeURIComponent).join("/"),
        };
      }),
    ),
  );
  const entries = localizedEntries.flat();
  yield* Effect.forEach(
    locales,
    (locale) =>
      Effect.gen(function* () {
        const documents = entries
          .filter((entry) => entry.locale === locale)
          .map((entry) => ({
            path: entry.path,
            title: entry.page.title,
            description: entry.page.description,
            text: entry.page.text,
          }));
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(SearchIndex))(documents);
        yield* Effect.promise(() => mkdir(join(options.outputDir, locale), { recursive: true }));
        yield* Effect.promise(() =>
          writeFile(join(options.outputDir, locale, "search.json"), json),
        );
      }),
    { discard: true },
  );
  const menuFiles = files.filter(
    (file) => file.startsWith("docs" + sep) && basename(file) === "meta.json",
  );
  const navigation = yield* Effect.forEach(locales, (locale) =>
    Effect.gen(function* () {
      const menus = yield* Effect.forEach(menuFiles, (file) =>
        Effect.gen(function* () {
          const localizedFile = `${file.slice(0, -5)}.${locale}.json`;
          const source = yield* Effect.promise(() =>
            readFile(
              join(contentRoot, sourceSet.has(localizedFile) ? localizedFile : file),
              "utf8",
            ),
          );
          const menu = yield* Schema.decodeUnknownEffect(ContentMenu)(JSON.parse(source));
          return { ...menu, directory: dirname(file).split(sep).join("/") };
        }),
      );
      return { locale, groups: yield* documentationNavigation(entries, menus, locale) };
    }),
  );
  const indexes = locales.flatMap((locale) =>
    ContentCollection.literals.map((collection) => collectionIndex(entries, locale, collection)),
  );
  const published = [
    ...locales.map(homeEntry),
    freeSigningEntry,
    ...entries,
    ...indexes,
    ...locales.flatMap((locale) => blogTagIndexes(entries, locale)),
  ];
  yield* Effect.forEach(
    published,
    (entry) =>
      Effect.gen(function* () {
        const path = localizedSitePath(entry.path, entry.locale);
        const menu = navigation.find((candidate) => candidate.locale === entry.locale);
        if (menu === undefined)
          return yield* Effect.die(`Documentation navigation is missing: ${entry.locale}`);
        const flags = {
          navigation: menu.groups,
          alternates: published
            .filter((candidate) => candidate.path === entry.path)
            .map((candidate) => candidate.locale),
          page: entry.page,
          locale: entry.locale,
          path: entry.path,
          siteUrl: options.siteUrl,
          sourceUrl: entries.find(
            (document) => document.locale === entry.locale && document.path === entry.path,
          )?.sourceUrl,
        };
        const rendered = yield* renderToString(contentApplication, {
          flags,
          buildId,
        });
        const html = yield* renderContentDocument(
          rendered,
          {
            entryScript: "/assets/content.js",
            stylesheets: ["/assets/content.css"],
            modulePreloads: [],
          },
          flags,
        );
        const destination = join(options.outputDir, path, "index.html");
        yield* Effect.promise(() => mkdir(dirname(destination), { recursive: true }));
        yield* Effect.promise(() => writeFile(destination, html));
        const image = yield* images.render(entry.page);
        yield* Effect.promise(() => writeFile(join(options.outputDir, `${path}.webp`), image));
      }),
    { discard: true },
  );

  const feeds = yield* rssArtifacts(entries, options.siteUrl);
  const artifacts = [
    sitemapArtifact(published, options.siteUrl),
    ...feeds,
    ...textArtifacts(entries, options.siteUrl),
  ];
  yield* Effect.forEach(
    artifacts,
    (artifact) =>
      Effect.gen(function* () {
        const destination = join(options.outputDir, artifact.path);
        yield* Effect.promise(() => mkdir(dirname(destination), { recursive: true }));
        yield* Effect.promise(() => writeFile(destination, artifact.content));
      }),
    { discard: true },
  );

  return { pages: published.length, outputDir: options.outputDir };
});

if (import.meta.main) {
  const result = await Effect.runPromise(
    buildContentSite({
      outputDir: process.argv[2] ?? join(appRoot, "dist/foldkit"),
      siteUrl: "https://signaturekit.dev",
    }).pipe(Effect.provide(Layer.merge(contentHighlighterLayer, socialImagesLayer))),
  );
  console.log(`Published ${result.pages} Foldkit content pages to ${result.outputDir}`);
}
