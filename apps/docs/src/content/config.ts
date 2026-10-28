import { Schema } from "effect";

import { SiteLocale } from "../../lib/site-route.ts";

export const ContentMetadata = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  packages: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ version: Schema.String })),
  ),
});

export const ContentHeadingTag = Schema.Literals(["h2", "h3", "h4", "h5", "h6"]);

export const ContentHeading = Schema.Struct({
  tag: ContentHeadingTag,
  id: Schema.NonEmptyString,
  title: Schema.String,
});

export const ContentPage = Schema.Struct({
  ...ContentMetadata.fields,
  html: Schema.String,
  headings: Schema.Array(ContentHeading),
  text: Schema.String,
});

export type ContentPage = typeof ContentPage.Type;

export const ContentCompilation = Schema.Struct({
  ...ContentPage.fields,
  markdown: Schema.String,
});

export type ContentCompilation = typeof ContentCompilation.Type;

export const ContentEntry = Schema.Struct({
  locale: SiteLocale,
  path: Schema.String,
  page: ContentPage,
});

export type ContentEntry = typeof ContentEntry.Type;

export const ContentDocument = Schema.Struct({
  ...ContentEntry.fields,
  markdown: Schema.String,
  sourceLocale: SiteLocale,
  sourceUrl: Schema.optional(Schema.NonEmptyString),
});

export type ContentDocument = typeof ContentDocument.Type;

export const ContentCollection = Schema.Literals(["blog", "changelog"]);

export const ContentMenu = Schema.Struct({
  title: Schema.String,
  pages: Schema.Array(Schema.String),
});

export const DocumentationMenu = Schema.Struct({
  ...ContentMenu.fields,
  directory: Schema.String,
});

export type DocumentationMenu = typeof DocumentationMenu.Type;

export const ContentLink = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
});

export const DocumentationGroup = Schema.Struct({
  title: Schema.String,
  items: Schema.Array(ContentLink),
});

export type DocumentationGroup = typeof DocumentationGroup.Type;

export const SearchDocument = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  text: Schema.String,
});

export const SearchIndex = Schema.Array(SearchDocument);

export type SearchIndex = typeof SearchIndex.Type;

export const PublicationArtifact = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});

export type PublicationArtifact = typeof PublicationArtifact.Type;
