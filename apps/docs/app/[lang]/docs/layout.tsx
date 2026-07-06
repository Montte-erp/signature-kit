import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale } from "@/lib/locale";

export default async function Layout({ params, children }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  return (
    <DocsLayout tree={source.getPageTree(locale)} {...baseOptions(locale)}>
      {children}
    </DocsLayout>
  );
}
