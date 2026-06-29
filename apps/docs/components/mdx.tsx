import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import type { MDXComponents } from "mdx/types";
import { ErrorCatalog } from "./error-catalog";
import { Mermaid } from "./mermaid";

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
    ErrorCatalog,
    Mermaid,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
