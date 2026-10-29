import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { baseLocale, locales } from "../../paraglide/runtime.js";
import { blogTagIndexes, collectionIndex, documentationNavigation } from "./catalog.ts";
import { ContentCollection, ContentMenu, SearchIndex } from "./config.ts";
import { compileContent } from "./compile.ts";
import { homeEntry } from "../site/landing.ts";
import { freeSigningEntry } from "../site/free-signing.ts";

import { localizedSitePath } from "../../lib/site-route.ts";
import { SiteContent, SiteAsset } from "../site/config.ts";
import { SocialImages } from "./social.ts";
import { rssArtifacts, sitemapArtifact, textArtifacts } from "./publication.ts";

const contentRoot = fileURLToPath(new URL("../../content/", import.meta.url));

export const loadContentCatalog = Effect.fn(function* () {
  const files = yield* Effect.promise(() => readdir(contentRoot, { recursive: true }));
  const sources = files.filter((file) => file.endsWith(".mdx"));
  const sourceSet = new Set(files);
  const baseSources = sources.filter(
    (file) => !locales.some((locale) => file.endsWith(`.${locale}.mdx`)),
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
  return { entries, navigation, published };
});

export const loadSiteContent = Effect.fn(function* (siteUrl: string) {
  const { entries, navigation, published } = yield* loadContentCatalog();
  const images = yield* SocialImages;
  const pages = yield* Effect.forEach(published, (entry) =>
    Effect.gen(function* () {
      const menu = navigation.find((candidate) => candidate.locale === entry.locale);
      if (menu === undefined)
        return yield* Effect.die(`Documentation navigation is missing: ${entry.locale}`);
      return {
        navigation: menu.groups,
        alternates: published
          .filter((candidate) => candidate.path === entry.path)
          .map((candidate) => candidate.locale),
        page: entry.page,
        locale: entry.locale,
        path: entry.path,
        siteUrl,
        sourceUrl: entries.find(
          (document) => document.locale === entry.locale && document.path === entry.path,
        )?.sourceUrl,
      };
    }),
  );
  const search = yield* Effect.forEach(locales, (locale) =>
    Effect.gen(function* () {
      const documents = entries
        .filter((entry) => entry.locale === locale)
        .map((entry) => ({
          path: entry.path,
          title: entry.page.title,
          description: entry.page.description,
          text: entry.page.text,
        }));
      const source = yield* Schema.encodeEffect(Schema.fromJsonString(SearchIndex))(documents);
      return {
        fileName: `${locale}/search.json`,
        contentType: "application/json",
        source,
      } satisfies typeof SiteAsset.Type;
    }),
  );
  const social = yield* Effect.forEach(published, (entry) =>
    Effect.gen(function* () {
      const source = yield* images.render(entry.page);
      return {
        fileName: localizedSitePath(entry.path, entry.locale).slice(1) + ".webp",
        contentType: "image/webp",
        source,
      } satisfies typeof SiteAsset.Type;
    }),
  );
  const feeds = yield* rssArtifacts(entries, siteUrl);
  const artifacts = [
    sitemapArtifact(published, siteUrl),
    ...feeds,
    ...textArtifacts(entries, siteUrl),
  ];
  const text = artifacts.map((artifact): typeof SiteAsset.Type => ({
    fileName: artifact.path,
    contentType: artifact.path.endsWith(".xml")
      ? "application/xml"
      : artifact.path.endsWith(".md")
        ? "text/markdown"
        : "text/plain",
    source: artifact.content,
  }));
  return { pages, assets: [...search, ...social, ...text] } satisfies typeof SiteContent.Type;
});
