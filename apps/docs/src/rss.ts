import { getPressContext } from "fumapress";
import { getBlogPosts } from "fumapress/plugins/blog";
import type { SiteContext } from "../press.config";

import { parseLocale } from "@/lib/locale";
import { captureServerEvent } from "@/lib/posthog/server";
import { absoluteUrl } from "@/lib/site";

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
  const posts = await getBlogPosts(getPressContext<SiteContext>(), locale);
  const channelUrl = absoluteUrl(`/${locale}/blog`);
  const copy =
    locale === "pt-BR"
      ? {
          title: "Blog do SignatureKit",
          description: "Histórias, integrações e decisões de engenharia do SignatureKit.",
        }
      : {
          title: "SignatureKit Blog",
          description: "Stories, integrations, and engineering decisions behind SignatureKit.",
        };
  const items = posts
    .map(
      ({ page, date }) => `<item>
<title>${escapeXml(page.data.title ?? copy.title)}</title>
<link>${escapeXml(absoluteUrl(page.url))}</link>
<guid>${escapeXml(absoluteUrl(page.url))}</guid>
${date === undefined ? "" : `<pubDate>${date.toUTCString()}</pubDate>`}
<description>${escapeXml(page.data.description ?? "")}</description>
</item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(copy.title)}</title>
<link>${escapeXml(channelUrl)}</link>
<description>${escapeXml(copy.description)}</description>
<language>${locale}</language>
<atom:link href="${escapeXml(`${channelUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
