import { pageRoute } from "./routes";
import { Schema } from "effect";
import { signatureKitErrorCatalog } from "@signature-kit/signatures";
import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import { contentPaths, expressionText, resolveContent } from "./content";
import type { ContentNode, Locale } from "./content";

export const SearchQuery = Schema.String.check(Schema.isMaxLength(200));
export const SearchResult = Schema.Struct({
  title: Schema.String,
  heading: Schema.String,
  excerpt: Schema.String,
  href: Schema.String,
});
export const SearchResults = Schema.Array(SearchResult);
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const searchDocs = (
  locale: Locale,
  query: string,
  pages = contentPaths().flatMap((path) => {
    if (
      !path.startsWith("docs/") ||
      (locale === "pt-BR" ? !path.endsWith(".pt-BR") : path.endsWith(".pt-BR"))
    )
      return [];
    const slug = path.slice(5).replace(/\.pt-BR$/, "");
    const page = resolveContent(locale, "docs", slug);
    return page === undefined ? [] : [{ slug, page }];
  }),
): typeof SearchResults.Type => {
  const decoded = Schema.decodeUnknownOption(SearchQuery)(query);
  if (decoded._tag === "None") return [];
  const terms = normalize(decoded.value)
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];
  const results: {
    title: string;
    heading: string;
    excerpt: string;
    href: string;
    score: number;
  }[] = [];
  for (const { slug, page } of pages) {
    const base = pageRoute({
      locale,
      path: `docs${slug === "index" ? "" : `/${slug.split("/").map(encodeURIComponent).join("/")}`}`,
    });
    const slugger = new GithubSlugger();
    const sections: { heading: string; href: string; text: string }[] = [
      { heading: "", href: base, text: page.description ?? "" },
    ];
    const visit = (nodes: ContentNode[]) => {
      for (const node of nodes) {
        if (node.type === "heading") {
          const children = [...(node.children ?? [])];
          const last = children.at(-1);
          const marker =
            last?.type === "text" ? last.value?.match(/\s*\[#([^\]\s]+)\]\s*$/) : undefined;
          if (marker !== null && marker !== undefined && last?.type === "text")
            children[children.length - 1] = { ...last, value: last.value?.slice(0, marker.index) };
          const heading = children
            .map(function visible(node): string {
              if (node.type === "mdxTextExpression") return expressionText(node);
              if ("children" in node) return node.children.map(visible).join("");
              return toString(node);
            })
            .join("");
          let id = marker?.[1];
          if (id !== undefined) {
            const original = id;
            let suffix = 0;
            while (Object.hasOwn(slugger.occurrences, id)) id = `${original}-${++suffix}`;
            slugger.occurrences[id] = 0;
          } else id = slugger.slug(toString({ type: "root", children }));
          sections.push({ heading, href: `${base}#${encodeURIComponent(id)}`, text: "" });
        } else if (
          (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
          (node.name === "Step" || node.name === "Card" || node.name === "Callout")
        ) {
          const attr = (name: string) => {
            const entry = node.attributes.find(
              (entry) => entry.type === "mdxJsxAttribute" && entry.name === name,
            );
            const value = entry?.type === "mdxJsxAttribute" ? entry.value : undefined;
            return typeof value === "string" ? value : "";
          };
          const section = sections.at(-1);
          if (node.name === "Step" && attr("title").length > 0 && section !== undefined)
            sections.push({ heading: attr("title"), href: section.href, text: "" });
          else if (section !== undefined)
            section.text += ` ${attr("title")} ${node.name === "Card" ? attr("description") : ""}`;
          visit(node.children);
        } else if (
          (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
          node.name === "ErrorCatalog"
        ) {
          for (const entry of signatureKitErrorCatalog)
            sections.push({
              heading: entry.code,
              href: `${base}#${encodeURIComponent(entry.code.replace("signature-kit.", "err-"))}`,
              text: `${entry.code} ${entry.message}${entry.overridable ? " editable" : ""}`,
            });
        } else if (node.type === "mdxTextExpression" || node.type === "mdxFlowExpression") {
          const section = sections.at(-1);
          if (section !== undefined) section.text += ` ${expressionText(node)}`;
        } else if (node.type === "text" || node.type === "inlineCode" || node.type === "code") {
          const section = sections.at(-1);
          if (section !== undefined) section.text += ` ${node.value ?? ""}`;
        } else if ("children" in node) visit(node.children);
      }
    };
    visit(page.nodes);
    for (const section of sections) {
      const title = normalize(page.title);
      const heading = normalize(section.heading);
      const body = normalize(section.text);
      if (
        !terms.every(
          (term) => title.includes(term) || heading.includes(term) || body.includes(term),
        )
      )
        continue;
      const score = terms.reduce(
        (sum, term) =>
          sum +
          (title.includes(term) ? 10 : 0) +
          (heading.includes(term) ? 5 : 0) +
          (body.includes(term) ? 1 : 0),
        0,
      );
      results.push({
        title: page.title,
        heading: section.heading,
        excerpt: section.text.trim().replace(/\s+/g, " ").slice(0, 200),
        href: section.href,
        score,
      });
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.href.localeCompare(b.href))
    .slice(0, 20)
    .map(({ score: _score, ...result }) => result);
};
