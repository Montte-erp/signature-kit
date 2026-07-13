import type { ConfigContext, ServerPlugin } from "fumapress";
import type { BlogLayout } from "fumapress/plugins/blog";

import HomePage from "@/src/site/home";
import AssineDocumentosGratisPage from "@/src/site/sign-free";
import { rssHandler } from "@/src/rss";
import { i18n, signFreeLocales, signFreePath } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";

export function siteRoutesPlugin<C extends ConfigContext>(
  HomeLayout: BlogLayout<C>,
): ServerPlugin<C> {
  return {
    name: "signature-kit:site-routes",
    createPages({ createApiIsomorphic, createLayout, createPage }) {
      createLayout({
        render: "static",
        path: "/[lang]/(site)",
        component: HomeLayout,
      });
      createPage({
        render: "static",
        path: "/[lang]/(site)",
        staticPaths: i18n.languages,
        component: HomePage,
      });
      createPage({
        render: "static",
        path: `/[lang]/(site)${signFreePath}`,
        staticPaths: signFreeLocales,
        component: AssineDocumentosGratisPage,
      });
      createApiIsomorphic({
        render: "dynamic",
        path: "/",
        async handler(request) {
          return Response.redirect(new URL(`/${i18n.defaultLanguage}`, request.url), 307);
        },
      });
      createApiIsomorphic({
        render: "static",
        path: "/robots.txt",
        async handler() {
          return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        },
      });
      createApiIsomorphic({
        render: "dynamic",
        path: "/[lang]/blog/rss.xml",
        handler: rssHandler,
      });
    },
  };
}
