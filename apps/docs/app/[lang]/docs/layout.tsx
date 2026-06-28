import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { LayoutTab } from "fumadocs-ui/layouts/shared";
import { baseOptions } from "@/lib/layout.shared";
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale, type Lang } from "@/lib/locale";
 
const docsPath = (lang: Lang, suffix: string): string => `/${lang}/docs${suffix}`;
 
function docsTabs(lang: Lang): LayoutTab[] {
  if (lang === "pt-BR") {
    return [
      {
        title: "Comece aqui",
        description: "Instale o A1 e assine os primeiros bytes.",
        url: docsPath(lang, ""),
        urls: new Set([docsPath(lang, ""), docsPath(lang, "/installation"), docsPath(lang, "/quickstart")]),
      },
      {
        title: "Assinatura",
        description: "Boundary, certificados, XML, PDF e erros.",
        url: docsPath(lang, "/signers"),
        urls: new Set([
          docsPath(lang, "/signers"),
          docsPath(lang, "/certificates"),
          docsPath(lang, "/pdf"),
          docsPath(lang, "/xml"),
          docsPath(lang, "/errors"),
        ]),
      },
      {
        title: "React A1",
        description: "Navegador como infraestrutura sobre Effect.",
        url: docsPath(lang, "/components"),
        urls: new Set([
          docsPath(lang, "/components"),
          docsPath(lang, "/components/browser-signing"),
        ]),
      },
      {
        title: "APIs remotas",
        description: "Providers reconciliáveis quando houver backend.",
        url: docsPath(lang, "/providers"),
        urls: new Set([
          docsPath(lang, "/providers"),
          docsPath(lang, "/providers/clicksign"),
          docsPath(lang, "/providers/assinafy"),
          docsPath(lang, "/providers/zapsign"),
          docsPath(lang, "/providers/docuseal"),
          docsPath(lang, "/providers/documenso"),
        ]),
      },
    ];
  }

  return [
    {
      title: "Start",
      description: "Install A1 and sign the first bytes.",
      url: docsPath(lang, ""),
      urls: new Set([docsPath(lang, ""), docsPath(lang, "/installation"), docsPath(lang, "/quickstart")]),
    },
    {
      title: "Signing",
      description: "Boundary, certificates, XML, PDF, and errors.",
      url: docsPath(lang, "/signers"),
      urls: new Set([
        docsPath(lang, "/signers"),
        docsPath(lang, "/certificates"),
        docsPath(lang, "/pdf"),
        docsPath(lang, "/xml"),
        docsPath(lang, "/errors"),
      ]),
    },
    {
      title: "React A1",
      description: "Browser infrastructure over Effect.",
      url: docsPath(lang, "/components"),
      urls: new Set([
        docsPath(lang, "/components"),
        docsPath(lang, "/components/browser-signing"),
      ]),
    },
    {
      title: "Remote APIs",
      description: "Reconciled providers when a backend is involved.",
      url: docsPath(lang, "/providers"),
      urls: new Set([
        docsPath(lang, "/providers"),
        docsPath(lang, "/providers/clicksign"),
        docsPath(lang, "/providers/assinafy"),
        docsPath(lang, "/providers/zapsign"),
        docsPath(lang, "/providers/docuseal"),
        docsPath(lang, "/providers/documenso"),
      ]),
    },
  ];
}

export default async function Layout({ params, children }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  // Prime the request locale so the docs chrome (nav + built-in switcher) is
  // localized, and pull the per-locale page tree.
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  return (
    <DocsLayout tree={source.getPageTree(locale)} tabs={docsTabs(locale)} tabMode="top" {...baseOptions(locale)}>
      {children}
    </DocsLayout>
  );
}
