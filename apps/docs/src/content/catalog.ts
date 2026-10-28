import { Array as EffectArray, Effect, Match } from "effect";
import type { Element } from "hast";
import { toString } from "hast-util-to-string";
import { toHtml } from "hast-util-to-html";

import { m } from "../../paraglide/messages.js";
import { localizedSitePath } from "../../lib/site-route.ts";
import type { ContentCollection, ContentEntry, DocumentationMenu } from "./config.ts";

type Locale = ContentEntry["locale"];

export const collectionIndex = (
  entries: readonly ContentEntry[],
  locale: Locale,
  collection: typeof ContentCollection.Type,
): ContentEntry => {
  const copy = Match.value(collection).pipe(
    Match.when("blog", () => ({
      title: "Blog",
      description:
        locale === "pt-BR"
          ? "Artigos sobre assinaturas digitais, TypeScript e infraestrutura Effect-native."
          : "Articles about digital signatures, TypeScript, and Effect-native infrastructure.",
    })),
    Match.when("changelog", () => ({
      title: "Changelog",
      description:
        locale === "pt-BR"
          ? "Notas de versão dos pacotes SignatureKit."
          : "Release notes for SignatureKit packages.",
    })),
    Match.exhaustive,
  );
  const items = entries
    .filter((entry) => entry.locale === locale && entry.path.startsWith(`${collection}/`))
    .sort(
      (left, right) =>
        (right.page.date ?? "").localeCompare(left.page.date ?? "") ||
        left.path.localeCompare(right.path),
    );
  const children: Element[] = items.map((entry) => ({
    type: "element",
    tagName: "article",
    properties: { className: ["collection-entry"] },
    children: [
      {
        type: "element",
        tagName: "h2",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: localizedSitePath(entry.path, locale) },
            children: [{ type: "text", value: entry.page.title }],
          },
        ],
      },
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: entry.page.description ?? "" }],
      },
    ],
  }));
  if (collection === "blog") {
    children.unshift({
      type: "element",
      tagName: "nav",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "a",
          properties: { href: localizedSitePath("blog/tags", locale) },
          children: [{ type: "text", value: m.site_blog_tags({}, { locale }) }],
        },
        { type: "text", value: " · " },
        {
          type: "element",
          tagName: "a",
          properties: { href: localizedSitePath("blog/rss.xml", locale) },
          children: [{ type: "text", value: "RSS" }],
        },
      ],
    });
  }
  return {
    locale,
    path: collection,
    page: {
      ...copy,
      headings: [],
      html: toHtml({ type: "root", children }),
      text: toString({ type: "root", children }),
    },
  };
};

export const documentationNavigation = Effect.fn(function* (
  entries: readonly ContentEntry[],
  menus: readonly DocumentationMenu[],
  locale: Locale,
) {
  const root = menus.find((menu) => menu.directory === "docs");
  if (root === undefined) return yield* Effect.die("Documentation requires a root menu");
  return yield* Effect.forEach(root.pages, (section) =>
    Effect.gen(function* () {
      const directory = section === "index" ? "docs" : `docs/${section}`;
      const menu =
        section === "index" ? root : menus.find((candidate) => candidate.directory === directory);
      if (menu === undefined)
        return yield* Effect.die(`Documentation menu is missing: ${directory}`);
      const pages = section === "index" ? ["index"] : menu.pages;
      const items = yield* Effect.forEach(pages, (slug) => {
        const path = slug === "index" ? directory : `${directory}/${slug}`;
        const entry = entries.find(
          (candidate) => candidate.locale === locale && candidate.path === path,
        );
        return entry === undefined
          ? Effect.die(`Documentation menu target is missing: ${locale}/${path}`)
          : Effect.succeed({ path: entry.path, title: entry.page.title });
      });
      return { title: menu.title, items };
    }),
  );
});

const tagSlug = (tag: string): string => tag.toLowerCase().replace(/\s+/g, "-");

export const blogTagIndexes = (
  entries: readonly ContentEntry[],
  locale: Locale,
): ContentEntry[] => {
  const options = { locale };
  const posts = entries.filter(
    (entry) => entry.locale === locale && entry.path.startsWith("blog/"),
  );
  const groups = EffectArray.groupBy(
    posts.flatMap((entry) => entry.page.tags ?? []),
    tagSlug,
  );
  const tags = Object.entries(groups)
    .map(([slug, labels]) => ({
      slug,
      label: labels[0],
      posts: posts.filter(
        (entry) => entry.page.tags?.some((tag) => tagSlug(tag) === slug) === true,
      ),
    }))
    .sort(
      (left, right) =>
        right.posts.length - left.posts.length || left.label.localeCompare(right.label, locale),
    );
  const children: Element[] = tags.map((tag) => ({
    type: "element",
    tagName: "p",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: localizedSitePath(`blog/tags/${tag.slug}`, locale) },
        children: [{ type: "text", value: tag.label }],
      },
      { type: "text", value: ` (${tag.posts.length})` },
    ],
  }));
  return [
    {
      locale,
      path: "blog/tags",
      page: {
        title: m.site_blog_tags({}, options),
        description: m.site_blog_tags_description({}, options),
        html: toHtml({ type: "root", children }),
        text: toString({ type: "root", children }),
        headings: [],
      },
    },
    ...tags.map((tag) => {
      const index = collectionIndex(tag.posts, locale, "blog");
      return {
        ...index,
        path: `blog/tags/${tag.slug}`,
        page: {
          ...index.page,
          title: m.site_blog_tag_title({ tag: tag.label }, options),
          description: m.site_blog_tag_description({ count: tag.posts.length }, options),
        },
      };
    }),
  ];
};
