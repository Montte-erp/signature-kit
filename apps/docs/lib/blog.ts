import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { blogSource } from "@/lib/blog-source";
import type { Lang } from "@/lib/locale";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

export const blogPostPath = (lang: Lang, slugs: ReadonlyArray<string>): string =>
  `/${lang}/blog/${slugs.join("/")}`;

export function sortedPosts(lang: Lang) {
  return blogSource
    .getPages(lang)
    .slice()
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

export function readingMinutes(slug: string, lang: Lang): number {
  const candidates =
    lang === "en-US" ? [`${slug}.mdx`] : [`${slug}.${lang}.mdx`, `${slug}.mdx`];

  for (const file of candidates) {
    const candidate = path.join(BLOG_DIR, file);
    if (!existsSync(candidate)) continue;
    const raw = readFileSync(candidate, "utf8");
    const body = raw
      .replace(/^---[\s\S]*?---/, "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`[\]()]/g, " ");
    const words = body.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }
  return 1;
}
