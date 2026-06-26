import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";

import { blogSource } from "@/lib/blog-source";
import { getMDXComponents } from "@/components/mdx";
import { setServerLocale } from "@/lib/server-locale";
import type { Lang } from "@/lib/locale";

/**
 * Single blog post. Lives in the `(home)` route group for the landing nav +
 * footer. The post body is the Fumadocs MDX page rendered with the same
 * `MDXComponents` the docs use, wrapped in `DocsBody` (the shared `prose`
 * surface) inside a readable `max-w-3xl` column. Title/description/date/author
 * come from frontmatter and are rendered in the header, mirroring how the docs
 * page keeps `DocsTitle`/`DocsDescription` out of the body.
 */

const COPY = {
  "en-US": { back: "Back to blog", by: "By" },
  "pt-BR": { back: "Voltar ao blog", by: "Por" },
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
  // Prime the request locale for this segment before rendering server chrome.
  setServerLocale(lang as Lang);

  const page = blogSource.getPage([slug], lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const copy = COPY[lang as Lang];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-28 pb-24 sm:pt-32">
      <Link
        href={`/${lang}/blog`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {copy.back}
      </Link>

      <header className="mt-8 flex flex-col gap-4 border-b border-border pb-8">
        <p className="font-mono text-xs text-muted-foreground">
          {formatDate(page.data.date, lang as Lang)}
          {" · "}
          {copy.by} {page.data.author}
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
  const page = blogSource.getPage([slug], lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
