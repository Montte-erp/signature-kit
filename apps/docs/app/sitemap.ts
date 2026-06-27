import type { MetadataRoute } from "next";

import { source } from "@/lib/source";
import { SITE_URL } from "@/lib/site";
import { blogPostPath, sortedPosts } from "@/lib/blog";
import type { Lang } from "@/lib/locale";

const langs: ReadonlyArray<Lang> = ["en-US", "pt-BR"];

const byLang = (make: (lang: Lang) => string): Record<Lang, string> => ({
  "en-US": make("en-US"),
  "pt-BR": make("pt-BR"),
});

/** One sitemap entry per locale, cross-linked via `alternates.languages`. */
function localized(pathByLang: Record<Lang, string>, lastModified?: string): MetadataRoute.Sitemap {
  const languages = {
    "en-US": `${SITE_URL}${pathByLang["en-US"]}`,
    "pt-BR": `${SITE_URL}${pathByLang["pt-BR"]}`,
  };
  return langs.map((lang) => ({
    url: `${SITE_URL}${pathByLang[lang]}`,
    lastModified: lastModified ? new Date(lastModified) : undefined,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const out: MetadataRoute.Sitemap = [];

  out.push(...localized(byLang((l) => `/${l}`)));
  out.push(...localized(byLang((l) => `/${l}/blog`)));

  out.push({
    url: `${SITE_URL}/pt-BR/assine-documentos-gratis`,
    alternates: { languages: { "pt-BR": `${SITE_URL}/pt-BR/assine-documentos-gratis` } },
  });

  // Docs pages — the slug set is shared across locales (pt-BR falls back to en-US).
  for (const page of source.getPages("en-US")) {
    const sub = page.slugs.length ? `/${page.slugs.join("/")}` : "";
    out.push(...localized(byLang((l) => `/${l}/docs${sub}`)));
  }

  // Blog posts.
  for (const post of sortedPosts("en-US")) {
    out.push(...localized(byLang((l) => blogPostPath(l, post.slugs)), post.data.date));
  }

  return out;
}
