import { createChangelogIndexPage } from "@fumapress/tegami";
import type { ConfigContext } from "fumapress";
import { createBlogIndexPage } from "fumapress/layouts/blog.index";
import { createBlogTagPage, createBlogTagsPage } from "fumapress/layouts/blog.tags";
import { createDocsLayoutPage } from "fumapress/layouts/docs";
import { createHomeLayout } from "fumapress/layouts/home";
import { createRootLayout } from "fumapress/layouts/root";
import type { ReactNode } from "react";
import { unstable_notFound as notFound } from "waku/router/server";

import { LocaleProvider } from "@/components/locale-provider";
import { ReducedMotionProvider } from "@/components/reduced-motion-provider";
import { Footer } from "@/components/sections/footer";
import type { Locale } from "@/lib/locale";
import { parseLocale } from "@/lib/locale";
import { setServerLocale } from "@/lib/server-locale";
import { absoluteUrl, OG_LOCALE, SITE_NAME } from "@/lib/site";

const collectionCopy = (locale: Locale) =>
  locale === "pt-BR"
    ? {
        blogDescription:
          "Artigos sobre assinaturas digitais, TypeScript e infraestrutura Effect-native.",
        blogTags: "Tags do blog",
        blogTagsDescription: "Explore os artigos por assunto.",
        changelogDescription: "Notas de versão dos pacotes SignatureKit.",
      }
    : {
        blogDescription:
          "Articles about digital signatures, TypeScript, and Effect-native infrastructure.",
        blogTags: "Blog tags",
        blogTagsDescription: "Explore articles by topic.",
        changelogDescription: "Release notes for SignatureKit packages.",
      };

function CollectionMeta({
  locale,
  path,
  title,
  description,
}: {
  readonly locale: Locale;
  readonly path: string;
  readonly title: string;
  readonly description: string;
}) {
  const url = absoluteUrl(`/${locale}${path}`);

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="en-US" href={absoluteUrl(`/en-US${path}`)} />
      <link rel="alternate" hrefLang="pt-BR" href={absoluteUrl(`/pt-BR${path}`)} />
      <link rel="alternate" hrefLang="x-default" href={absoluteUrl(`/en-US${path}`)} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:locale" content={OG_LOCALE[locale]} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
}

export function createSiteLayouts<C extends ConfigContext>() {
  const PressRootLayout = createRootLayout<C>();
  const PressHomeLayout = createHomeLayout<C>({ inherit: { layoutProps: true } });
  const englishCopy = collectionCopy("en-US");
  const portugueseCopy = collectionCopy("pt-BR");
  const PressBlogIndex = {
    "en-US": createBlogIndexPage<C>({ description: englishCopy.blogDescription }),
    "pt-BR": createBlogIndexPage<C>({ description: portugueseCopy.blogDescription }),
  };
  const PressBlogTags = {
    "en-US": createBlogTagsPage<C>({
      heading: englishCopy.blogTags,
      description: englishCopy.blogTagsDescription,
    }),
    "pt-BR": createBlogTagsPage<C>({
      heading: portugueseCopy.blogTags,
      description: portugueseCopy.blogTagsDescription,
    }),
  };
  const PressBlogTag = createBlogTagPage<C>();
  const PressChangelogIndex = {
    "en-US": createChangelogIndexPage<C>({ description: englishCopy.changelogDescription }),
    "pt-BR": createChangelogIndexPage<C>({ description: portugueseCopy.changelogDescription }),
  };
  const DocsPage = createDocsLayoutPage<C>();

  function RootLayout({
    lang,
    children,
  }: {
    readonly lang?: string;
    readonly children: ReactNode;
  }) {
    const locale = parseLocale(lang ?? "") ?? "en-US";
    setServerLocale(locale);

    return (
      <PressRootLayout lang={locale}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </PressRootLayout>
    );
  }

  function HomeLayout({
    lang,
    children,
  }: {
    readonly lang?: string;
    readonly children: ReactNode;
  }) {
    const locale = parseLocale(lang ?? "");
    if (locale === undefined) return notFound();
    setServerLocale(locale);

    return (
      <ReducedMotionProvider>
        <PressHomeLayout lang={locale}>
          {children}
          <Footer />
        </PressHomeLayout>
      </ReducedMotionProvider>
    );
  }

  function BlogIndex({ lang }: { readonly lang?: string }) {
    const locale = parseLocale(lang ?? "");
    if (locale === undefined) return notFound();
    setServerLocale(locale);
    const copy = collectionCopy(locale);
    const Page = PressBlogIndex[locale];

    return (
      <>
        <CollectionMeta
          locale={locale}
          path="/blog"
          title={`Blog | ${SITE_NAME}`}
          description={copy.blogDescription}
        />
        <Page lang={locale} />
      </>
    );
  }

  function BlogTags({ lang }: { readonly lang?: string }) {
    const locale = parseLocale(lang ?? "");
    if (locale === undefined) return notFound();
    setServerLocale(locale);
    const copy = collectionCopy(locale);
    const Page = PressBlogTags[locale];

    return (
      <>
        <CollectionMeta
          locale={locale}
          path="/blog/tags"
          title={`${copy.blogTags} | ${SITE_NAME}`}
          description={copy.blogTagsDescription}
        />
        <Page lang={locale} />
      </>
    );
  }

  function BlogTag({ lang, tag }: { readonly lang?: string; readonly tag: string }) {
    const locale = parseLocale(lang ?? "");
    if (locale === undefined) return notFound();
    setServerLocale(locale);
    const copy = collectionCopy(locale);

    return (
      <>
        <CollectionMeta
          locale={locale}
          path={`/blog/tags/${encodeURIComponent(tag)}`}
          title={`${tag} — Blog | ${SITE_NAME}`}
          description={copy.blogTagsDescription}
        />
        <PressBlogTag lang={locale} tag={tag} />
      </>
    );
  }

  function ChangelogIndex({ lang }: { readonly lang?: string }) {
    const locale = parseLocale(lang ?? "");
    if (locale === undefined) return notFound();
    setServerLocale(locale);
    const copy = collectionCopy(locale);
    const Page = PressChangelogIndex[locale];

    return (
      <>
        <CollectionMeta
          locale={locale}
          path="/changelog"
          title={`Changelog | ${SITE_NAME}`}
          description={copy.changelogDescription}
        />
        <Page lang={locale} />
      </>
    );
  }

  return {
    BlogIndex,
    BlogTag,
    BlogTags,
    ChangelogIndex,
    DocsPage,
    HomeLayout,
    RootLayout,
  };
}
