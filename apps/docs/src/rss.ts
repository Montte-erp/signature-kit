import { getPressContext } from "fumapress";
import type { SiteContext } from "../press.config";

import { parseLocale } from "@/lib/locale";
import { captureServerEvent } from "@/lib/posthog/server";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export async function rssHandler(
  request: Request,
  { params }: { readonly params: Record<string, string | string[]> },
): Promise<Response> {
  const language = params.lang;
  const locale = parseLocale(typeof language === "string" ? language : "");
  if (locale === undefined) return new Response("Not found", { status: 404 });

  await captureServerEvent("blog_rss_requested", request, { locale });
  const source = await getPressContext<SiteContext>().getLoader();
  const posts = source
    .getPages(locale)
    .flatMap((page) => (page.type === "blog" ? [page] : []))
    .sort((left, right) => right.data.date.getTime() - left.data.date.getTime());
  const channelUrl = `${SITE_URL}/${locale}/blog`;
  const items = posts
    .map(
      (post) => `<item>
<title>${escapeXml(post.data.title)}</title>
<link>${escapeXml(absoluteUrl(post.url))}</link>
<guid>${escapeXml(absoluteUrl(post.url))}</guid>
<pubDate>${post.data.date.toUTCString()}</pubDate>
<description>${escapeXml(post.data.description ?? "")}</description>
</item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(`${SITE_NAME} Blog`)}</title>
<link>${escapeXml(channelUrl)}</link>
<description>${escapeXml(
    locale === "pt-BR"
      ? "Histórias, integrações e decisões de engenharia do SignatureKit."
      : "Stories, integrations, and engineering decisions behind SignatureKit.",
  )}</description>
<language>${locale}</language>
<atom:link href="${escapeXml(`${channelUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}

const absoluteUrl = (path: string): string => new URL(path, SITE_URL).href;
