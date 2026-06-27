import { source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { parseLocale } from "@/lib/locale";
import { setServerLocale } from "@/lib/server-locale";

export default async function Page(props: PageProps<"/[lang]/docs/[[...slug]]">) {
  const params = await props.params;
  const locale = parseLocale(params.lang);
  if (locale === undefined) notFound();
  setServerLocale(locale);
  const page = source.getPage(params.slug, locale);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: "clerk" }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/[lang]/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const locale = parseLocale(params.lang);
  if (locale === undefined) notFound();
  const page = source.getPage(params.slug, locale);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
