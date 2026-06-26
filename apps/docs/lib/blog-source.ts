import { blog } from "collections/server";
import { loader } from "fumadocs-core/source";
import { i18n } from "@/lib/i18n";

/**
 * Blog source — a second Fumadocs `loader` alongside `lib/source.ts`, sharing the
 * same i18n config so `/en-US/blog/...` and `/pt-BR/blog/...` both resolve and the
 * `*.pt-BR.mdx` siblings match. `baseUrl: "/blog"` keeps the blog off the docs
 * tree; posts live flat under `content/blog`.
 */
export const blogSource = loader({
  baseUrl: "/blog",
  i18n,
  source: blog.toFumadocsSource(),
});
