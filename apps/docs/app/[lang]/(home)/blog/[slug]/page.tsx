import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";

import { blogSource } from "@/lib/blog-source";
import { getMDXComponents } from "@/components/mdx";
import { setServerLocale } from "@/lib/server-locale";
import { i18n } from "@/lib/i18n";
import { OG_LOCALE, SITE_NAME, absoluteUrl } from "@/lib/site";
import { blogPostPath, readingMinutes } from "@/lib/blog";
import type { Lang } from "@/lib/locale";

/**
 * Single blog post — in the `(home)` route group for the landing nav + footer.
 * The body is the Fumadocs MDX page (shared `MDXComponents`, wrapped in `DocsBody`)
 * in a readable `max-w-3xl` column. Frontmatter drives the header AND the full SEO
 * surface: canonical + hreflang alternates, OpenGraph `article`, Twitter card,
 * and BlogPosting JSON-LD. The dynamic OG image is wired by the colocated
 * `opengraph-image.tsx`.
 */

const COPY = {
  "en-US": { back: "Back to blog", by: "By", min: "min read" },
  "pt-BR": { back: "Voltar ao blog", by: "Por", min: "min de leitura" },
} satisfies Record<Lang, Record<string, string>>;

function formatDate(date: string, lang: Lang): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(lang, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function BlogPost(
  props: PageProps<"/[lang]/blog/[slug]">,
) {
  const { lang, slug } = await props.params;
  const locale = lang as Lang;
  // Prime the request locale for this segment before rendering server chrome.
  setServerLocale(locale);

  const page = blogSource.getPage([slug], lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const copy = COPY[locale];
  const minutes = readingMinutes(slug, locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: page.data.title,
    description: page.data.description,
    datePublished: new Date(page.data.date).toISOString(),
    inLanguage: locale,
    url: absoluteUrl(blogPostPath(locale, page.slugs)),
    author: { "@type": "Organization", name: page.data.author },
    publisher: { "@type": "Organization", name: SITE_NAME },
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-28 pb-24 sm:pt-32">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href={`/${lang}/blog`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {copy.back}
      </Link>

      <header className="mt-8 flex flex-col gap-4 border-b border-border pb-8">
        <p className="font-mono text-xs text-muted-foreground">
          {formatDate(page.data.date, locale)}
          {" · "}
          {copy.by} {page.data.author}
          {" · "}
          {minutes} {copy.min}
        </p>
        <h1 className="text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
          {page.data.title}
        </h1>
        {page.data.description ? (
          <p className="max-w-[62ch] text-base leading-relaxed text-pretty text-muted-foreground">
            {page.data.description}
          </p>
        ) : null}
      </header>

      <DocsBody className="mt-10">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(blogSource, page),
          })}
        />
      </DocsBody>
    </main>
  );
}

export function generateStaticParams() {
  return blogSource.generateParams().map((param) => ({
    lang: param.lang,
    slug: param.slug.join("/"),
  }));
}

export async function generateMetadata(
  props: PageProps<"/[lang]/blog/[slug]">,
): Promise<Metadata> {
  const { lang, slug } = await props.params;
  const locale = lang as Lang;
  const page = blogSource.getPage([slug], lang);
  if (!page) notFound();

  const url = absoluteUrl(blogPostPath(locale, page.slugs));
  const languages = Object.fromEntries(
    i18n.languages.map((l) => [l, absoluteUrl(blogPostPath(l as Lang, page.slugs))]),
  );

  return {
    title: page.data.title,
    description: page.data.description,
    authors: [{ name: page.data.author }],
    alternates: {
      canonical: url,
      languages,
      types: {
        "application/rss+xml": absoluteUrl(`/${locale}/blog/rss.xml`),
      },
    },
    openGraph: {
      type: "article",
      url,
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      title: page.data.title,
      description: page.data.description,
      publishedTime: new Date(page.data.date).toISOString(),
      authors: [page.data.author],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
    },
  };
}
