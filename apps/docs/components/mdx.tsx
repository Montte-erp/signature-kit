import type { ReactNode } from "react";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import type { MDXComponents } from "mdx/types";
import { localePath } from "@/lib/links";
import { ErrorCatalog } from "./error-catalog";
import { Mermaid } from "./mermaid";

function LocalizedCard({
  title,
  href,
  description,
  children,
}: {
  readonly title: string;
  readonly href: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card title={title} href={localePath(href)} description={description}>
      {children}
    </Card>
  );
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs,
    Step,
    Steps,
    Accordion,
    Accordions,
    TypeTable,
    File,
    Files,
    Folder,
    Callout,
    Card,
    Cards,
    LocalizedCard,
    ErrorCatalog,
    Mermaid,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
