import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale } from "@/lib/locale";

export default async function Layout({ params, children }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  // Prime the request locale so the docs chrome (nav + built-in switcher) is
  // localized, and pull the per-locale page tree.
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  return (
    <DocsLayout tree={source.getPageTree(locale)} {...baseOptions(locale)}>
      {children}
    </DocsLayout>
  );
}
