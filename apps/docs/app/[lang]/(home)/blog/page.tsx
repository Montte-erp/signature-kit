import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { blogSource } from "@/lib/blog-source";
import { i18n } from "@/lib/i18n";
import { setServerLocale } from "@/lib/server-locale";
import type { Lang } from "@/lib/locale";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Blog index. Lives in the `(home)` route group so it inherits the landing nav +
 * footer (see `(home)/layout.tsx`). Lists every post for the active locale as a
 * shadcn Card. Locale-aware copy is branched literally on `lang` (the messages
 * catalog is owned elsewhere); each internal href carries the `[lang]` prefix so
 * navigation never bounces through the proxy's Accept-Language redirect.
 */

const COPY = {
  "en-US": {
    eyebrow: "Blog",
    title: "Field notes",
    lead: "Crossovers, integration stories, and the reasoning behind SignatureKit — written while building it.",
    by: "By",
    read: "Read post",
    empty: "No posts yet.",
  },
  "pt-BR": {
    eyebrow: "Blog",
    title: "Notas de campo",
    lead: "Crossovers, histórias de integração e o raciocínio por trás do SignatureKit — escritos enquanto o construímos.",
    by: "Por",
    read: "Ler post",
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
  // Prime the request locale for this segment (Next renders segments
  // independently from the `(home)` layout).
  setServerLocale(lang as Lang);

  const copy = COPY[lang as Lang];
  const posts = blogSource
    .getPages(lang)
    .sort(
      (a, b) =>
        new Date(b.data.date).getTime() - new Date(a.data.date).getTime(),
    );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-28 pb-24 sm:pt-32">
      <header className="max-w-3xl">
        <p className="font-mono text-xs text-muted-foreground">
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
          {copy.lead}
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="mt-12 text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <Link
              key={post.url}
              href={`/${lang}/blog/${post.slugs.join("/")}`}
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Card className="h-full gap-4 transition-colors hover:border-foreground/20">
                <CardHeader>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-muted-foreground/70">
                    {formatDate(post.data.date, lang as Lang)}
                    {" · "}
                    {copy.by} {post.data.author}
                  </p>
                  <CardTitle className="mt-2 text-lg font-medium tracking-tight">
                    {post.data.title}
                  </CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">
                    {post.data.description}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors group-hover:text-foreground">
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

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Crossovers, integration stories, and the reasoning behind SignatureKit.",
};
