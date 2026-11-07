import { homeRoute, pageRoute, parsePublicUrl } from "./routes";
import { Effect } from "effect";
import { createArticleCatalog } from "./articles";
import { contentPaths, resolveContent } from "./content";
import type { Locale } from "./content";

const locales: Locale[] = ["en-US", "pt-BR"];
const origin = "https://signaturekit.dev";
const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const url = (path: string) => `${origin}${path.split("/").map(encodeURIComponent).join("/")}`;

export const renderRss = (
  locale: Locale,
  entries: ReturnType<ReturnType<typeof createArticleCatalog>["articles"]>,
) => {
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
  const channel = url(pageRoute({ locale, path: "blog" }));
  const items = entries
    .map(
      (entry) =>
        `<item><title>${escapeXml(entry.title)}</title><link>${escapeXml(
          `${origin}${entry.href
            .split("/")
            .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
            .join("/")}`,
        )}</link><guid>${escapeXml(
          `${origin}${entry.href
            .split("/")
            .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
            .join("/")}`,
        )}</guid><pubDate>${new Date(entry.timestamp).toUTCString()}</pubDate><description>${escapeXml(entry.description ?? "")}</description></item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeXml(copy.title)}</title><link>${channel}</link><description>${escapeXml(copy.description)}</description><language>${locale}</language><atom:link href="${url(pageRoute({ locale, path: "blog/rss.xml" }))}" rel="self" type="application/rss+xml" />${items}</channel></rss>`;
};

export const createFeeds = (source: {
  paths: typeof contentPaths;
  resolve: typeof resolveContent;
}) => {
  const { articles, blogTags } = createArticleCatalog(source);
  const renderSitemap = () => {
    const pages = locales.flatMap((locale) => {
      const staticPaths = [
        "",
        "/blog",
        "/blog/tags",
        "/changelog",
        locale === "pt-BR" ? "/assine-documentos-gratis" : "/sign-free",
        ...blogTags(locale).map(({ slug }) => `/blog/tags/${slug}`),
      ];
      const docs = source
        .paths()
        .filter(
          (path) =>
            path.startsWith("docs/") &&
            (locale === "pt-BR" ? path.endsWith(".pt-BR") : !path.endsWith(".pt-BR")),
        )
        .map((path) => {
          const slug = path.slice(5).replace(/\.pt-BR$/, "");
          return slug === "index" ? "/docs" : `/docs/${slug}`;
        })
        .filter((path) => source.resolve(locale, "docs", path.slice(6)));
      const articlePages = (["blog", "changelog"] satisfies ("blog" | "changelog")[]).flatMap(
        (section) =>
          articles(locale, section)
            .filter((entry) => source.resolve(locale, section, entry.slug))
            .map((entry) => ({ path: `/${section}/${entry.slug}`, date: entry.date })),
      );
      return [
        ...[...staticPaths, ...docs].map((path) => ({ locale, path, date: undefined })),
        ...articlePages.map((entry) => ({ locale, ...entry })),
      ];
    });
    const entries = pages
      .map((page) => {
        const links = pages
          .filter(
            (candidate) =>
              candidate.path === page.path ||
              ((page.path === "/sign-free" || page.path === "/assine-documentos-gratis") &&
                (candidate.path === "/sign-free" ||
                  candidate.path === "/assine-documentos-gratis")),
          )
          .map(
            (candidate) =>
              `<xhtml:link rel="alternate" hreflang="${candidate.locale}" href="${escapeXml(url(candidate.path === "" ? homeRoute({ locale: candidate.locale }) : pageRoute({ locale: candidate.locale, path: candidate.path.slice(1) })))}" />`,
          )
          .join("");
        return `<url><loc>${escapeXml(url(page.path === "" ? homeRoute({ locale: page.locale }) : pageRoute({ locale: page.locale, path: page.path.slice(1) })))}</loc>${page.date !== undefined && page.date !== "" ? `<lastmod>${page.date}</lastmod>` : ""}${links}</url>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries}</urlset>`;
  };

  const feedResponse = (request: Request): Effect.Effect<Response | undefined> =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname;
      const parsed = parsePublicUrl(request.url);
      const rss = parsed?._tag === "Page" && parsed.path === "blog/rss.xml";
      if (path !== "/sitemap.xml" && !rss) return undefined;
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      const locale: Locale = parsed?.locale ?? "en-US";
      const body = rss
        ? renderRss(
            locale,
            articles(locale, "blog").filter((entry) => source.resolve(locale, "blog", entry.slug)),
          )
        : renderSitemap();
      return new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": rss ? "application/rss+xml; charset=utf-8" : "application/xml",
        },
      });
    });

  return { renderSitemap, feedResponse };
};
export const { renderSitemap, feedResponse } = createFeeds({
  paths: contentPaths,
  resolve: resolveContent,
});
