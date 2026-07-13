import { changelogMetaSchema, changelogPageSchema } from "@fumapress/tegami/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import {
  blogMetaSchema,
  blogPageSchema,
  metaSchema,
  pageSchema,
} from "fumapress/adapters/mdx/schema";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

const blogSchema = blogPageSchema.extend({
  date: changelogPageSchema.shape.date,
  author: blogPageSchema.shape.title,
});

export const blog = defineDocs({
  dir: "content/blog",
  docs: {
    schema: blogSchema,
  },
  meta: {
    schema: blogMetaSchema,
  },
});

export const changelog = defineDocs({
  dir: "content/changelog",
  docs: {
    schema: changelogPageSchema,
  },
  meta: {
    schema: changelogMetaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    rehypeCodeOptions: {
      themes: {
        light: "vitesse-light",
        dark: "vitesse-dark",
      },
    },
  },
});
