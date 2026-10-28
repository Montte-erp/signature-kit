import { Effect, Schema } from "effect";
import { locales } from "../../paraglide/runtime.js";
import { m } from "../../paraglide/messages.js";
import type { Root as XmlRoot } from "xast";
import type { RootContent as MarkdownContent } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { toXml } from "xast-util-to-xml";
import { x } from "xastscript";

import { localizedSitePath } from "../../lib/site-route.ts";
import type { ContentDocument, ContentEntry, PublicationArtifact } from "./config.ts";

export const sitemapArtifact = (
  entries: readonly ContentEntry[],
  siteUrl: string,
): PublicationArtifact => {
  const document: XmlRoot = {
    type: "root",
    children: [
      { type: "instruction", name: "xml", value: 'version="1.0" encoding="UTF-8"' },
      x(
        "urlset",
        {
          xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
          "xmlns:xhtml": "http://www.w3.org/1999/xhtml",
        },
        entries.map((entry) =>
          x("url", [
            x("loc", siteUrl + localizedSitePath(entry.path, entry.locale)),
            ...entries
              .filter((candidate) => candidate.path === entry.path)
              .map((candidate) =>
                x("xhtml:link", {
                  rel: "alternate",
                  hreflang: candidate.locale,
                  href: siteUrl + localizedSitePath(candidate.path, candidate.locale),
                }),
              ),
          ]),
        ),
      ),
    ],
  };
  return { path: "sitemap.xml", content: toXml(document) };
};

export const rssArtifacts = Effect.fn(function* (
  documents: readonly ContentDocument[],
  siteUrl: string,
) {
  const articles = yield* Effect.forEach(
    documents.filter(
      (entry) =>
        entry.locale === entry.sourceLocale &&
        (entry.path.startsWith("blog/") || entry.path.startsWith("changelog/")),
    ),
    (entry) =>
      Effect.gen(function* () {
        const date =
          entry.page.date === undefined
            ? undefined
            : yield* Schema.decodeUnknownEffect(Schema.DateFromString)(entry.page.date);
        return { entry, date };
      }),
  );
  articles.sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0));
  const channels = [
    ...locales.map((locale) => ({
      path: `${locale}/blog/rss.xml`,
      title: m.site_feed_title({}, { locale }),
      description: m.site_feed_description({}, { locale }),
      link: siteUrl + localizedSitePath("blog", locale),
      locale,
      articles: articles.filter(
        ({ entry }) => entry.locale === locale && entry.path.startsWith("blog/"),
      ),
    })),
    {
      path: "rss.xml",
      title: "SignatureKit",
      description: "SignatureKit",
      link: siteUrl + "/",
      articles,
    },
  ];
  return channels.map((channel): PublicationArtifact => {
    const document: XmlRoot = {
      type: "root",
      children: [
        { type: "instruction", name: "xml", value: 'version="1.0" encoding="UTF-8"' },
        x("rss", { version: "2.0", "xmlns:atom": "http://www.w3.org/2005/Atom" }, [
          x("channel", [
            x("title", channel.title),
            x("link", channel.link),
            x("description", channel.description),
            ...("locale" in channel ? [x("language", channel.locale)] : []),
            ...(channel.articles[0]?.date === undefined
              ? []
              : [x("lastBuildDate", channel.articles[0].date.toUTCString())]),
            x("atom:link", {
              href: `${siteUrl}/${channel.path}`,
              rel: "self",
              type: "application/rss+xml",
            }),
            ...channel.articles.map(({ entry, date }) =>
              x("item", [
                x("title", entry.page.title),
                x("link", siteUrl + localizedSitePath(entry.path, entry.locale)),
                x("guid", siteUrl + localizedSitePath(entry.path, entry.locale)),
                ...(entry.page.description === undefined
                  ? []
                  : [x("description", entry.page.description)]),
                ...(date === undefined ? [] : [x("pubDate", date.toUTCString())]),
              ]),
            ),
          ]),
        ]),
      ],
    };
    return { path: channel.path, content: toXml(document) };
  });
});

export const textArtifacts = (
  documents: readonly ContentDocument[],
  siteUrl: string,
): PublicationArtifact[] => {
  const markdown = documents.map((entry): PublicationArtifact => ({
    path: localizedSitePath(entry.path, entry.locale).slice(1) + ".md",
    content:
      toMarkdown({
        type: "root",
        children: [
          {
            type: "heading",
            depth: 1,
            children: [
              {
                type: "text",
                value: `${entry.page.title} (${localizedSitePath(entry.path, entry.locale)})`,
              },
            ],
          },
        ],
      }) +
      "\n" +
      entry.markdown +
      "\n",
  }));
  const contents: MarkdownContent[] = [
    { type: "heading", depth: 1, children: [{ type: "text", value: "SignatureKit" }] },
  ];
  const originals = documents.filter((entry) => entry.locale === entry.sourceLocale);
  for (const locale of locales) {
    contents.push(
      { type: "heading", depth: 2, children: [{ type: "text", value: locale }] },
      {
        type: "list",
        ordered: false,
        children: originals
          .filter((entry) => entry.locale === locale)
          .map((entry) => ({
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "link",
                    url: siteUrl + localizedSitePath(entry.path, entry.locale),
                    children: [{ type: "text", value: entry.page.title }],
                  },
                  {
                    type: "text",
                    value:
                      entry.page.description === undefined ? "" : ": " + entry.page.description,
                  },
                ],
              },
            ],
          })),
      },
    );
  }
  return [
    ...markdown,
    { path: "robots.txt", content: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n` },
    { path: "llms.txt", content: toMarkdown({ type: "root", children: contents }) },
    {
      path: "llms-full.txt",
      content:
        originals
          .map((entry) => {
            const header = toMarkdown({
              type: "root",
              children: [
                {
                  type: "heading",
                  depth: 1,
                  children: [
                    {
                      type: "text",
                      value: `${entry.page.title} (${localizedSitePath(entry.path, entry.locale)})`,
                    },
                  ],
                },
              ],
            });
            return header + "\n" + entry.markdown;
          })
          .join("\n\n") + "\n",
    },
  ];
};
