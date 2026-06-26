import { readFileSync } from "node:fs";
import path from "node:path";

import { blogSource } from "@/lib/blog-source";
import type { Lang } from "@/lib/locale";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

/** Root-relative URL for a post in a locale. */
export const blogPostPath = (lang: Lang, slugs: ReadonlyArray<string>): string =>
  `/${lang}/blog/${slugs.join("/")}`;

/** Posts for a locale, newest first. */
export function sortedPosts(lang: Lang) {
  return blogSource
    .getPages(lang)
    .slice()
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

/**
 * Build-time reading estimate, read from the raw MDX (frontmatter and fenced code
 * blocks stripped, ~200 wpm). Falls back across the locale sibling to the en-US
 * source so an untranslated post still reports a sensible number.
 */
export function readingMinutes(slug: string, lang: Lang): number {
  const candidates =
    lang === "en-US" ? [`${slug}.mdx`] : [`${slug}.${lang}.mdx`, `${slug}.mdx`];

  for (const file of candidates) {
    try {
      const raw = readFileSync(path.join(BLOG_DIR, file), "utf8");
      const body = raw
        .replace(/^---[\s\S]*?---/, "") // frontmatter
        .replace(/```[\s\S]*?```/g, " ") // fenced code
        .replace(/[#>*_`[\]()]/g, " "); // markdown punctuation
      const words = body.split(/\s+/).filter(Boolean).length;
      return Math.max(1, Math.round(words / 200));
    } catch {
      // try the next candidate
    }
  }
  return 1;
}
