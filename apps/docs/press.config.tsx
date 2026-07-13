import { changelogPlugin } from "@fumapress/tegami";
import { feedbackPlugin } from "@fumapress/feedback";
import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { blogPlugin } from "fumapress/plugins/blog";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { linkValidationPlugin } from "fumapress/plugins/link-validation";
import { sitemapPlugin } from "fumapress/plugins/sitemap";
import { takumiPlugin } from "fumapress/plugins/takumi";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { createRelativeLink } from "fumadocs-ui/mdx";

import { blog, changelog, docs } from "./.source/server";
import { getMDXComponents } from "@/components/mdx";
import { i18n, translations } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { parseLocale } from "@/lib/locale";
import { captureServerEventWithoutRequest, docsAnalyticsPlugin } from "@/lib/posthog/server";
import { absoluteUrl, OG_LOCALE, SITE_NAME, SITE_URL } from "@/lib/site";
import { createSiteLayouts } from "@/src/layouts";
import { siteRoutesPlugin } from "@/src/site-routes";

const localizedUrl = (url: string, language: string): string => {
  const segments = url.split("/");
  if (i18n.languages.some((candidate) => candidate === segments[1])) segments[1] = language;
  return absoluteUrl(segments.join("/"));
};

const baseConfig = defineConfig({
  content: {
    docs: docs.toFumadocsSource({ baseDir: "docs" }),
    blog: blog.toFumadocsSource({ baseDir: "blog" }),
    changelog: changelog.toFumadocsSource({ baseDir: "changelog" }),
  },
  i18n,
  translations,
  site: {
    name: SITE_NAME,
    baseUrl: SITE_URL,
    git: {
      user: "Montte-erp",
      repo: "signature-kit",
      branch: "main",
      rootDir: "apps/docs",
    },
  },
  loaderOptions: {
    plugins: [lucideIconsPlugin()],
  },
  meta: {
    root() {
      return (
        <>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#1f1f1f" media="(prefers-color-scheme: dark)" />
          <meta property="og:site_name" content={SITE_NAME} />
          <meta name="twitter:card" content="summary_large_image" />
        </>
      );
    },
    page(page) {
      const locale =
        i18n.languages.find((candidate) => page.url.startsWith(`/${candidate}/`)) ??
        i18n.defaultLanguage;
      return (
        <>
          {page.data.description ? (
            <meta name="description" content={page.data.description} />
          ) : null}
          <link rel="canonical" href={absoluteUrl(page.url)} />
          <link rel="alternate" hrefLang="en-US" href={localizedUrl(page.url, "en-US")} />
          <link rel="alternate" hrefLang="pt-BR" href={localizedUrl(page.url, "pt-BR")} />
          <link rel="alternate" hrefLang="x-default" href={localizedUrl(page.url, "en-US")} />
          <meta property="og:type" content={page.type === "docs" ? "website" : "article"} />
          <meta property="og:url" content={absoluteUrl(page.url)} />
          <meta property="og:locale" content={OG_LOCALE[locale]} />
          <meta name="twitter:title" content={page.data.title} />
          {page.data.description ? (
            <meta name="twitter:description" content={page.data.description} />
          ) : null}
        </>
      );
    },
  },
});

export type SiteContext = typeof baseConfig.$context;

const siteLayouts = createSiteLayouts<SiteContext>();

export default baseConfig
  .plugins(
    docsAnalyticsPlugin<SiteContext>(),
    siteRoutesPlugin<SiteContext>(siteLayouts.HomeLayout),
    blogPlugin<SiteContext>({
      layouts: {
        index: siteLayouts.BlogIndex,
        layout: siteLayouts.HomeLayout,
        tag: siteLayouts.BlogTag,
        tags: siteLayouts.BlogTags,
      },
    }),
    changelogPlugin<SiteContext>({
      layouts: {
        index: siteLayouts.ChangelogIndex,
        layout: siteLayouts.HomeLayout,
      },
    }),
    feedbackPlugin({
      onPageFeedbackAction: async (feedback) => {
        "use server";
        await captureServerEventWithoutRequest("page_feedback_submitted", {
          opinion: feedback.opinion,
          route: feedback.url,
          message: feedback.message,
        });
        return {};
      },
      onTextFeedbackAction: async (feedback) => {
        "use server";
        await captureServerEventWithoutRequest("text_feedback_submitted", {
          route: feedback.url,
          block_id: feedback.blockId,
          block_body: feedback.blockBody,
          message: feedback.message,
        });
        return {};
      },
    }),
    flexsearchPlugin<SiteContext>(),
    takumiPlugin<SiteContext>(),
    sitemapPlugin<SiteContext>(),
    linkValidationPlugin<SiteContext>(),
  )
  .adapters(
    fumadocsMdx<SiteContext>({
      async getMdxComponents(page) {
        return getMDXComponents({
          a: createRelativeLink(await this.getLoader(), page),
        });
      },
    }),
  )
  .layouts({
    root: siteLayouts.RootLayout,
    page: siteLayouts.DocsPage,
    defaultProps({ lang }) {
      const locale = parseLocale(lang ?? "") ?? i18n.defaultLanguage;
      return {
        ...baseOptions(locale),
        githubUrl: "https://github.com/Montte-erp/signature-kit",
        links: [
          { text: locale === "pt-BR" ? "Documentação" : "Documentation", url: `/${locale}/docs` },
          { text: "Blog", url: `/${locale}/blog` },
          { text: "Changelog", url: `/${locale}/changelog` },
        ],
      };
    },
  });
