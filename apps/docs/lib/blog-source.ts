import { blog } from "collections/server";
import { loader } from "fumadocs-core/source";
import { i18n } from "@/lib/i18n";

export const blogSource = loader({
  baseUrl: "/blog",
  i18n,
  source: blog.toFumadocsSource(),
});
