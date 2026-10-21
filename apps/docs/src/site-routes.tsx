import type { AppShape, PressPlugin } from "fumapress";
import type { BlogLayout } from "fumapress/plugins/blog";

import HomePage from "@/src/site/home";
import AssineDocumentosGratisPage from "@/src/site/sign-free";
import { rssHandler } from "@/src/rss";
import { i18n, signFreeLocales, signFreePath } from "@/lib/i18n";

export function siteRoutesPlugin<C extends AppShape>(HomeLayout: BlogLayout<C>): PressPlugin<C> {
  return {
    name: "signature-kit:site-routes",
    createPages({ createApiIsomorphic, createLayout, createPage }) {
      for (const lang of i18n.languages) {
        createLayout({ render: "static", path: "/(site)", lang, component: HomeLayout });
        createPage({ render: "static", path: "/(site)", lang, component: HomePage });
      }
      for (const lang of signFreeLocales) {
        createPage({
          render: "static",
          path: `/(site)${signFreePath}`,
          lang,
          component: AssineDocumentosGratisPage,
        });
      }
      createApiIsomorphic({
        render: "dynamic",
        path: "/[lang]/blog/rss.xml",
        handler: rssHandler,
      });
    },
  };
}
