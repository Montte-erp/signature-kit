import { i18n } from "@/lib/i18n";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { blogPostPath, sortedPosts } from "@/lib/blog";
import { parseLocale, type Lang } from "@/lib/locale";

// Static per-locale RSS 2.0 feed at /{lang}/blog/rss.xml. Hand-rolled XML keeps it
// dependency-free; the static `rss.xml` segment wins over the sibling `[slug]`.
export const dynamic = "force-static";

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

const CHANNEL = {
  "en-US": {
    title: `${SITE_NAME} — Blog`,
    description:
      "Crossovers, integration stories, and the reasoning behind SignatureKit.",
  },
  "pt-BR": {
    title: `${SITE_NAME} — Blog`,
    description:
      "Crossovers, histórias de integração e o raciocínio por trás do SignatureKit.",
  },
} satisfies Record<Lang, { title: string; description: string }>;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  const locale = parseLocale(lang);
  if (locale === undefined) return new Response("Not found", { status: 404 });
  const channel = CHANNEL[locale];
  const self = `${SITE_URL}/${locale}/blog/rss.xml`;

  const items = sortedPosts(locale)
    .map((post) => {
      const url = `${SITE_URL}${blogPostPath(locale, post.slugs)}`;
      return `    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(post.data.date).toUTCString()}</pubDate>
      <dc:creator>${escapeXml(post.data.author)}</dc:creator>
      <description>${escapeXml(post.data.description ?? "")}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${SITE_URL}/${locale}/blog</link>
    <description>${escapeXml(channel.description)}</description>
    <language>${locale}</language>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
