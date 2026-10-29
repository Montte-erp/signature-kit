import { Schema } from "effect";
import { renderDocument } from "foldkit/experimental/server";
import type { DocumentAssets, RenderedApplication } from "foldkit/experimental/server";
import type { Element } from "hast";
import { toHtml } from "hast-util-to-html";

import { freeSigningPath, localizedSitePath } from "../../lib/site-route.ts";
import { freeSigningStructuredData } from "./free-signing.ts";
import { baseLocale } from "../../paraglide/runtime.js";
import type { ContentFlags } from "./application.ts";

export const contentDocument = (
  application: RenderedApplication,
  assets: DocumentAssets,
  flags: ContentFlags,
) => {
  // effect-boundary: application document decoding [allow-run: synchronous native SSR document boundary]
  const canonical = Schema.decodeUnknownSync(Schema.NonEmptyString)(application.canonical);
  const image = `${flags.siteUrl}${localizedSitePath(flags.path, flags.locale)}.webp`;
  const head: Element[] = [
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:image", content: image },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { name: "twitter:image", content: image },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:image:width", content: "1200" },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:image:height", content: "630" },
      children: [],
    },
    ...flags.alternates.map((locale): Element => ({
      type: "element",
      tagName: "link",
      properties: {
        rel: ["alternate"],
        hrefLang: locale,
        href: flags.siteUrl + localizedSitePath(flags.path, locale),
      },
      children: [],
    })),
    ...(flags.alternates.includes(baseLocale)
      ? [
          {
            type: "element",
            tagName: "link",
            properties: {
              rel: ["alternate"],
              hrefLang: "x-default",
              href: flags.siteUrl + localizedSitePath(flags.path, baseLocale),
            },
            children: [],
          } satisfies Element,
        ]
      : []),
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:site_name", content: "SignatureKit" },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:title", content: application.title },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: {
        property: "og:type",
        content:
          flags.path.startsWith("changelog/") ||
          (flags.path.startsWith("blog/") &&
            flags.path !== "blog/tags" &&
            !flags.path.startsWith("blog/tags/"))
            ? "article"
            : "website",
      },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { property: "og:locale", content: flags.locale.replaceAll("-", "_") },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { name: "twitter:card", content: "summary" },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { name: "twitter:title", content: application.title },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: { name: "twitter:url", content: canonical },
      children: [],
    },
  ];
  if (flags.page.description !== undefined) {
    head.push(
      {
        type: "element",
        tagName: "meta",
        properties: { name: "description", content: flags.page.description },
        children: [],
      },
      {
        type: "element",
        tagName: "meta",
        properties: { property: "og:description", content: flags.page.description },
        children: [],
      },
      {
        type: "element",
        tagName: "meta",
        properties: { name: "twitter:description", content: flags.page.description },
        children: [],
      },
    );
  }
  if (flags.path === freeSigningPath) {
    head.push({
      type: "element",
      tagName: "script",
      properties: { id: "assine-documentos-gratis-json-ld", type: "application/ld+json" },
      children: [
        {
          type: "text",
          value: JSON.stringify(freeSigningStructuredData(canonical)).replaceAll("<", "\\u003c"),
        },
      ],
    });
  }
  return renderDocument(application, assets, { head: toHtml({ type: "root", children: head }) });
};
