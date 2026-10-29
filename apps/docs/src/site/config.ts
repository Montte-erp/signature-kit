import { Schema } from "effect";
import { SiteLocale } from "../../lib/site-route.ts";
import { ContentDocument, ContentPage, DocumentationGroup } from "../content/config.ts";

export const ContentFlags = Schema.Struct({
  page: ContentPage,
  navigation: Schema.Array(DocumentationGroup),
  alternates: Schema.Array(SiteLocale),
  locale: SiteLocale,
  path: Schema.String,
  siteUrl: Schema.String,
  sourceUrl: ContentDocument.fields.sourceUrl,
});

export type ContentFlags = typeof ContentFlags.Type;

export const SiteAsset = Schema.Union([
  Schema.Struct({
    fileName: Schema.String,
    contentType: Schema.Literals([
      "application/json",
      "application/xml",
      "text/plain",
      "text/markdown",
    ]),
    source: Schema.String,
  }),
  Schema.Struct({
    fileName: Schema.String,
    contentType: Schema.Literals(["image/webp"]),
    source: Schema.Uint8ArrayFromBase64,
  }),
]);

export const SiteContent = Schema.Struct({
  pages: Schema.Array(ContentFlags),
  assets: Schema.Array(SiteAsset),
});
