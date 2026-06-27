import Link from "next/link";
import { ArrowRight, Rss } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { i18n } from "@/lib/i18n";
import { setServerLocale } from "@/lib/server-locale";
import { OG_LOCALE, SITE_NAME, absoluteUrl } from "@/lib/site";
import { blogPostPath, readingMinutes, sortedPosts } from "@/lib/blog";
import { parseLocale, type Lang } from "@/lib/locale";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Blog index — in the `(home)` route group for the landing nav + footer. Lists
 * every post for the active locale (newest first) as a shadcn Card with a reading
 * estimate, plus an RSS link. Copy is branched on `lang`; hrefs carry the `[lang]`
 * prefix so navigation never bounces through the proxy's Accept-Language redirect.
 */

const COPY = {
  "en-US": {
    eyebrow: "Blog",
    title: "Field notes",
    lead: "Crossovers, integration stories, and the reasoning behind SignatureKit — written while building it.",
    by: "By",
    min: "min read",
    read: "Read post",
    rss: "RSS",
    empty: "No posts yet.",
  },
  "pt-BR": {
    eyebrow: "Blog",
    title: "Notas de campo",
    lead: "Crossovers, histórias de integração e o raciocínio por trás do SignatureKit — escritos enquanto o construímos.",
    by: "Por",
    min: "min de leitura",
    read: "Ler post",
    rss: "RSS",
    empty: "Nenhum post ainda.",
  },
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

export default async function BlogIndex({ params }: PageProps<"/[lang]/blog">) {
  const { lang } = await params;
  const locale = parseLocale(lang);
  if (locale === undefined) notFound();
  // Prime the request locale for this segment (Next renders segments
  // independently from the `(home)` layout).
  setServerLocale(locale);

  const copy = COPY[locale];
  const posts = sortedPosts(locale);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-28 pb-24 sm:pt-32">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-xs text-muted-foreground">{copy.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
            {copy.lead}
          </p>
        </div>
        <a
          href={`/${lang}/blog/rss.xml`}
          className="inline-flex shrink-0 items-center gap-1.5 self-start font-mono text-xs text-muted-foreground transition-colors hover:text-foreground sm:self-end"
        >
          <Rss className="size-3.5" />
          {copy.rss}
        </a>
      </header>

      {posts.length === 0 ? (
        <p className="mt-12 text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <Link
              key={post.url}
              href={blogPostPath(locale, post.slugs)}
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Card className="h-full gap-4 transition-colors hover:border-foreground/20">
                <CardHeader>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-muted-foreground/70">
                    {formatDate(post.data.date, locale)}
                    {" · "}
                    {copy.by} {post.data.author}
                    {" · "}
                    {readingMinutes(post.slugs.join("/"), locale)} {copy.min}
                  </p>
                  <CardTitle className="mt-2 text-lg font-medium tracking-tight">
                    {post.data.title}
                  </CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">
                    {post.data.description}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {copy.read}
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/blog">): Promise<Metadata> {
  const { lang } = await params;
  const locale = parseLocale(lang);
  if (locale === undefined) notFound();
  const copy = COPY[locale];
  const url = absoluteUrl(`/${locale}/blog`);
  const languages = Object.fromEntries(
    i18n.languages.flatMap((language) => {
      const languageLocale = parseLocale(language);
      return languageLocale === undefined
        ? []
        : [[languageLocale, absoluteUrl(`/${languageLocale}/blog`)]];
    }),
  );

  return {
    title: copy.title,
    description: copy.lead,
    alternates: {
      canonical: url,
      languages,
      types: {
        "application/rss+xml": absoluteUrl(`/${locale}/blog/rss.xml`),
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      title: copy.title,
      description: copy.lead,
    },
  };
}
