import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// Blog frontmatter = the page schema plus `date` and `author`. We reuse
// `pageSchema.shape.title` (a Zod 4 `ZodString`) for the new fields so the schema
// stays on the exact zod instance fumadocs ships — a bare `import "zod"` resolves
// to a mismatched v3 in this workspace, which would break `.extend()`.
const blogSchema = pageSchema.extend({
  date: pageSchema.shape.title,
  author: pageSchema.shape.title,
});

export const blog = defineDocs({
  dir: "content/blog",
  docs: {
    schema: blogSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    // Match the landing's code blocks: server-highlighted with the Vitesse
    // themes, dark variant active under the pinned `.dark` class.
    rehypeCodeOptions: {
      themes: {
        light: "vitesse-light",
        dark: "vitesse-dark",
      },
    },
  },
});
