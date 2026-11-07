import { pageRoute } from "./routes";
import { Effect, Schema } from "effect";
import { contentPaths, resolveContent } from "./content";
import type { Locale } from "./content";

export type ArticleSection = "blog" | "changelog";

export const ArticleDate = Schema.Struct({
  date: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/),
    Schema.makeFilter((value) => {
      const year = Number(value.slice(0, 4));
      const month = Number(value.slice(5, 7));
      const day = Number(value.slice(8, 10));
      const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
      return (
        Number.isFinite(calendar.getTime()) &&
        calendar.getUTCFullYear() === year &&
        calendar.getUTCMonth() + 1 === month &&
        calendar.getUTCDate() === day
      );
    }),
  ).pipe(Schema.decodeTo(Schema.DateFromString)),
});

export const tagSlug = (tag: string) => tag.toLowerCase().replace(/\s+/g, "-");
export const indexTags = (
  entries: ReturnType<typeof indexArticles>,
  source: (slug: string) => ReturnType<typeof resolveContent>,
) => {
  const grouped = new Map<
    string,
    { slug: string; tag: string; entries: ReturnType<typeof indexArticles> }
  >();
  for (const entry of entries) {
    const content = source(entry.slug);
    if (content === undefined) continue;
    for (const tag of content.tags ?? []) {
      const slug = tagSlug(tag);
      const group = grouped.get(slug) ?? { slug, tag, entries: [] };
      group.entries.push(entry);
      grouped.set(slug, group);
    }
  }
  return [...grouped.values()];
};

export const indexArticles = (
  locale: Locale,
  section: ArticleSection,
  entries: Iterable<{
    slug: string;
    content: NonNullable<ReturnType<typeof resolveContent>> & { date: string; timestamp: number };
  }>,
) =>
  Array.from(entries, ({ slug, content }) => ({
    ...content,
    slug,
    href: pageRoute({ locale, path: `${section}/${encodeURIComponent(slug)}` }),
  })).sort((a, b) => b.timestamp - a.timestamp || a.slug.localeCompare(b.slug));

export const createArticleCatalog = (source: {
  paths: typeof contentPaths;
  resolve: typeof resolveContent;
}) => {
  const resolveArticle = (locale: Locale, section: ArticleSection, slug: string) => {
    if (slug.endsWith(".pt-BR")) return undefined;
    const content =
      source.resolve(locale, section, slug) ??
      (locale === "pt-BR" ? source.resolve("en-US", section, slug) : undefined);
    if (content === undefined) return undefined;
    // [allow-run: article dates are validated at the static content boundary]
    const { date } = Effect.runSync(Schema.decodeUnknownEffect(ArticleDate)(content));
    return { ...content, date: date.toISOString(), timestamp: date.getTime() };
  };

  const articles = (locale: Locale, section: ArticleSection) => {
    const slugs = new Set(
      source
        .paths()
        .filter((path) => path.startsWith(`${section}/`))
        .map((path) => path.slice(section.length + 1).replace(/\.pt-BR$/, "")),
    );
    return indexArticles(
      locale,
      section,
      [...slugs].flatMap((slug) => {
        const content = resolveArticle(locale, section, slug);
        return content !== undefined ? [{ slug, content }] : [];
      }),
    );
  };

  const articlePaths = () =>
    (["en-US", "pt-BR"] satisfies Locale[]).flatMap((locale) =>
      (["blog", "changelog"] satisfies ArticleSection[]).flatMap((section) => [
        pageRoute({ locale, path: section }),
        ...articles(locale, section).map((article) => article.href),
      ]),
    );

  const blogTags = (locale: Locale) =>
    indexTags(articles(locale, "blog"), (slug) => source.resolve(locale, "blog", slug));
  const tagPaths = () =>
    (["en-US", "pt-BR"] satisfies Locale[]).flatMap((locale) => [
      pageRoute({ locale, path: "blog/tags" }),
      ...blogTags(locale).map(({ slug }) =>
        pageRoute({ locale, path: `blog/tags/${encodeURIComponent(slug)}` }),
      ),
    ]);

  return { resolveArticle, articles, articlePaths, blogTags, tagPaths };
};

export const { resolveArticle, articles, articlePaths, blogTags, tagPaths } = createArticleCatalog({
  paths: contentPaths,
  resolve: resolveContent,
});
