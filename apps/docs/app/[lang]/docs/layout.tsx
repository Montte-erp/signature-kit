import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { setServerLocale } from "@/lib/server-locale";
import type { Lang } from "@/lib/locale";

export default async function Layout({ params, children }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  // Prime the request locale so the docs chrome (nav + built-in switcher) is
  // localized, and pull the per-locale page tree.
  setServerLocale(lang as Lang);

  return (
    <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang as Lang)}>
      {children}
    </DocsLayout>
  );
}
