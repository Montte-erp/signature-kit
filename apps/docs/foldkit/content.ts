import { pageRoute } from "./routes";
import type { Locale } from "./routes";
export type { Locale } from "./routes";
import { Effect, Schema } from "effect";
import { signatureKitErrorCatalog } from "@signature-kit/signatures";
import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseDocument } from "yaml";
import type { Html, HtmlBuilder } from "foldkit/html";
import { mermaidView } from "./mermaid";

const sources = import.meta.glob<string>("../content/{docs,blog,changelog}/**/*.mdx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const metadata = import.meta.glob<string>("../content/docs/**/meta*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
const Frontmatter = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
});
const ParsedFrontmatter = Schema.Struct({ valid: Schema.Literal(true), value: Frontmatter });
const Navigation = Schema.Struct({ title: Schema.String, pages: Schema.Array(Schema.String) });
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
type NativeNode = ReturnType<typeof parser.parse>["children"][number];
export type ContentNode = NativeNode;

export const parseContent = (source: string) => {
  const lines = source.split("\n");
  const start = lines[0]?.trim() === "---";
  const end = start ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const document = parseDocument(end < 0 ? "" : lines.slice(1, end).join("\n"));
  // [allow-run: static content is validated at the application boundary]
  const { value } = Effect.runSync(
    Schema.decodeUnknownEffect(ParsedFrontmatter)({
      valid: start && end >= 0 && document.errors.length === 0,
      value: document.errors.length === 0 ? document.toJS() : undefined,
    }).pipe(Effect.orDie),
  );
  const tree = parser.parse(lines.slice(end + 1).join("\n"));
  return { ...value, nodes: tree.children };
};

export const contentPaths = () =>
  Object.keys(sources).map((path) => path.slice("../content/".length, -4));
export const resolveContent = (locale: Locale, section: string, slug: string) => {
  const path = `../content/${section}/${slug || "index"}${locale === "pt-BR" ? ".pt-BR" : ""}.mdx`;
  const source = sources[path];
  return source === undefined ? undefined : parseContent(source);
};
export const docsNavigation = (locale: Locale) => {
  const suffix = locale === "pt-BR" ? ".pt-BR" : "";
  const read = (dir: string) => {
    const raw = metadata[`../content/docs/${dir}meta${suffix}.json`];
    if (raw === undefined) return undefined;
    const parsed = Schema.decodeUnknownOption(Navigation)(JSON.parse(raw));
    return parsed._tag === "Some" ? parsed.value : undefined;
  };
  const root = read("");
  if (root === undefined) return [];
  return root.pages.flatMap((part) => {
    const group = read(`${part}/`);
    if (group !== undefined)
      return [
        {
          title: group.title,
          links: group.pages.flatMap((page) => {
            const content = resolveContent(locale, "docs", `${part}/${page}`);
            return content !== undefined
              ? [
                  {
                    title: content.title,
                    href: pageRoute({ locale, path: `docs/${part}/${page}` }),
                  },
                ]
              : [];
          }),
        },
      ];
    const content = resolveContent(locale, "docs", part);
    return content !== undefined
      ? [
          {
            title: root.title,
            links: [
              {
                title: content.title,
                href: pageRoute({ locale, path: `docs${part === "index" ? "" : `/${part}`}` }),
              },
            ],
          },
        ]
      : [];
  });
};

export const expressionText = (
  node: Extract<ContentNode, { type: "mdxTextExpression" | "mdxFlowExpression" }>,
) => {
  const body = node.data?.estree?.body;
  if (body?.length === 0) return "";
  const expression =
    body?.length === 1 && body[0]?.type === "ExpressionStatement" ? body[0].expression : undefined;
  if (
    expression?.type === "Literal" &&
    (typeof expression.value === "string" || typeof expression.value === "number")
  )
    return String(expression.value);
  if (
    expression?.type === "Literal" &&
    (typeof expression.value === "boolean" || expression.value === null)
  )
    return "";
  throw new Error(`Unsupported MDX expression: ${node.value}`);
};

export const renderContent = <Message>(
  nodes: ContentNode[],
  h: HtmlBuilder<Message>,
): (Html | string)[] => {
  const slugger = new GithubSlugger();
  const containsFlow = (node: ContentNode): boolean =>
    isFlow(node) || ("children" in node && node.children.some(containsFlow));
  const isFlow = (node: ContentNode): boolean =>
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    (["Cards", "Steps", "Callout", "ErrorCatalog"].includes(node.name ?? "") ||
      (node.name === "Card" && (node.children ?? []).some(containsFlow)));
  const validate = (nodes: ContentNode[], parent: string, phrasing: boolean) => {
    for (const node of nodes) {
      const component = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
      if (component && node.name === "Step" && parent !== "Steps")
        throw new Error("Step requires Steps as its parent");
      if (
        parent === "Steps" &&
        node.type !== "paragraph" &&
        !(node.type === "text" && node.value.trim() === "") &&
        !(component && node.name === "Step")
      )
        throw new Error("Steps accepts only Step children");
      if (phrasing && isFlow(node)) throw new Error(`Flow component in ${parent}`);
      if ("children" in node)
        validate(
          node.children,
          node.type === "paragraph" && parent === "Steps"
            ? parent
            : component
              ? (node.name ?? "fragment")
              : node.type,
          phrasing || node.type === "heading" || node.type === "tableCell",
        );
    }
  };
  validate(nodes, "root", false);
  const render = (nodes: ContentNode[]): (Html | string)[] =>
    nodes.flatMap((node): (Html | string)[] => {
      if (node.type === "paragraph") {
        const split = (
          children: Extract<ContentNode, { type: "paragraph" }>["children"],
        ): { flow: boolean; nodes: Extract<ContentNode, { type: "paragraph" }>["children"] }[] => {
          const parts: {
            flow: boolean;
            nodes: Extract<ContentNode, { type: "paragraph" }>["children"];
          }[] = [];
          for (const child of children) {
            const flow = isFlow(child);
            const segments = flow
              ? [{ flow: true, nodes: [child] }]
              : child.type === "strong" ||
                  child.type === "emphasis" ||
                  child.type === "delete" ||
                  child.type === "link"
                ? split(child.children).map((part) =>
                    part.flow ? part : { flow: false, nodes: [{ ...child, children: part.nodes }] },
                  )
                : [{ flow: false, nodes: [child] }];
            for (const segment of segments) {
              const last = parts.at(-1);
              if (!segment.flow && last !== undefined && !last.flow)
                last.nodes.push(...segment.nodes);
              else parts.push(segment);
            }
          }
          return parts;
        };
        return split(node.children ?? []).flatMap((part) =>
          part.flow
            ? render(part.nodes)
            : part.nodes.length > 0
              ? [h.p([], render(part.nodes))]
              : [],
        );
      }
      return [renderNode(node)];
    });
  const renderNode = (node: ContentNode): Html | string => {
    const children =
      node.type === "table" ||
      node.type === "heading" ||
      ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        (node.name === "Cards" || node.name === "Steps"))
        ? []
        : node.type === "mdxJsxTextElement" &&
            ["Card", "Callout", "Step"].includes(node.name ?? "") &&
            node.children.some(containsFlow)
          ? render([{ type: "paragraph", children: node.children }])
          : render("children" in node ? node.children : []);
    switch (node.type) {
      case "text":
        return node.value ?? "";
      case "paragraph":
        return h.p([], children);
      case "heading": {
        const headingChildren = [...(node.children ?? [])];
        const last = headingChildren.at(-1);
        const marker =
          last?.type === "text" ? last.value?.match(/\s*\[#([^\]\s]+)\]\s*$/) : undefined;
        if (marker !== null && marker !== undefined && last?.type === "text")
          headingChildren[headingChildren.length - 1] = {
            ...last,
            value: last.value?.slice(0, marker.index),
          };
        let id = marker?.[1];
        if (id !== undefined) {
          const base = id;
          let suffix = 0;
          while (Object.hasOwn(slugger.occurrences, id)) id = `${base}-${++suffix}`;
          slugger.occurrences[id] = 0;
        } else id = slugger.slug(toString({ type: "root", children: headingChildren }));
        const heading = render(headingChildren);
        switch (node.depth) {
          case 1:
            return h.h1([h.Id(id)], heading);
          case 2:
            return h.h2([h.Id(id)], heading);
          case 3:
            return h.h3([h.Id(id)], heading);
          case 4:
            return h.h4([h.Id(id)], heading);
          case 5:
            return h.h5([h.Id(id)], heading);
          case 6:
            return h.h6([h.Id(id)], heading);
        }
      }
      case "strong":
        return h.strong([], children);
      case "emphasis":
        return h.em([], children);
      case "delete":
        return h.del([], children);
      case "inlineCode":
        return h.code([], [node.value ?? ""]);
      case "code":
        return node.lang === "mermaid"
          ? mermaidView(h, node.value ?? "", node.meta)
          : h.div(
              [],
              [
                node.meta != null && node.meta.length > 0 ? h.p([], [node.meta]) : null,
                h.pre(
                  [],
                  [h.code([h.Class(`language-${node.lang ?? "text"}`)], [node.value ?? ""])],
                ),
              ],
            );
      case "link":
        return h.a(
          [
            h.Href(safeUrl(node.url)),
            ...(node.title != null && node.title.length > 0 ? [h.Title(node.title)] : []),
          ],
          children,
        );
      case "image":
        return h.img([h.Src(safeUrl(node.url)), h.Alt(node.alt ?? "")]);
      case "list":
        return node.ordered === true
          ? h.ol(node.start != null && node.start !== 0 ? [h.Start(node.start)] : [], children)
          : h.ul([], children);
      case "listItem":
        return h.li([], children);
      case "blockquote":
        return h.blockquote([], children);
      case "thematicBreak":
        return h.hr([]);
      case "break":
        return h.br([]);
      case "table": {
        const [header, ...rows] = node.children ?? [];
        return h.table(
          [],
          [
            h.thead(
              [],
              [
                h.tr(
                  [],
                  (header?.children ?? []).map((cell) =>
                    h.th([h.Scope("col")], render(cell.children ?? [])),
                  ),
                ),
              ],
            ),
            h.tbody(
              [],
              rows.map((row) =>
                h.tr(
                  [],
                  (row.children ?? []).map((cell) => h.td([], render(cell.children ?? []))),
                ),
              ),
            ),
          ],
        );
      }
      case "tableRow":
        return h.tr([], children);
      case "tableCell":
        return h.td([], children);
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement": {
        const attr = (name: string) => {
          const entry = node.attributes.find(
            (entry) => entry.type === "mdxJsxAttribute" && entry.name === name,
          );
          return entry?.type === "mdxJsxAttribute" && typeof entry.value === "string"
            ? entry.value
            : undefined;
        };
        if (
          node.attributes.some(
            (entry) =>
              entry.type !== "mdxJsxAttribute" ||
              (entry.value !== null && typeof entry.value !== "string"),
          )
        )
          throw new Error(`Unsupported attributes on ${node.name ?? "fragment"}`);
        switch (node.name) {
          case "Cards":
            return h.div(
              [h.Class("cards")],
              render(
                (node.children ?? [])
                  .flatMap((child) =>
                    child.type === "paragraph" ? (child.children ?? []) : [child],
                  )
                  .filter((child) => child.type !== "text" || child.value.trim().length > 0),
              ),
            );
          case "Card": {
            const title = h.strong([], [attr("title") ?? ""]);
            const description = attr("description");
            const inline = node.type === "mdxJsxTextElement" && !isFlow(node);
            const body = inline
              ? [
                  title,
                  ...(description !== undefined && description.length > 0
                    ? [h.span([], [description])]
                    : []),
                  ...children,
                ]
              : [
                  title,
                  ...(description !== undefined && description.length > 0
                    ? [h.p([], [description])]
                    : []),
                  ...children,
                ];
            const href = attr("href");
            return href !== undefined && href.length > 0
              ? h.a([h.Class("card"), h.Href(safeUrl(href))], body)
              : inline
                ? h.span([h.Class("card")], body)
                : h.div([h.Class("card")], body);
          }
          case "ErrorCatalog":
            return h.div(
              [h.Class("error-catalog")],
              [
                h.div([], [h.span([], ["Code"]), h.span([], ["Default message"])]),
                ...signatureKitErrorCatalog.map((entry) =>
                  h.div(
                    [h.Id(entry.code.replace("signature-kit.", "err-"))],
                    [
                      h.code([], [entry.code]),
                      h.span([], [entry.message, entry.overridable ? " · editable" : ""]),
                    ],
                  ),
                ),
              ],
            );
          case "Callout":
            return h.aside(
              [h.Class(`callout ${attr("type") ?? "info"}`)],
              [
                (attr("title")?.length ?? 0) > 0 ? h.strong([], [attr("title") ?? ""]) : null,
                ...children,
              ],
            );
          case "Steps":
            return h.ol(
              [h.Class("steps")],
              render(
                (node.children ?? [])
                  .flatMap((child) =>
                    child.type === "paragraph" ? (child.children ?? []) : [child],
                  )
                  .filter((child) => child.type !== "text" || child.value.trim().length > 0),
              ),
            );
          case "Step":
            return h.li(
              [],
              [
                (attr("title")?.length ?? 0) > 0 ? h.h3([], [attr("title") ?? ""]) : null,
                ...children,
              ],
            );
          case null:
          default:
            throw new Error(`Unsupported MDX component: ${node.name ?? "fragment"}`);
        }
      }
      case "mdxTextExpression":
      case "mdxFlowExpression": {
        return expressionText(node);
      }
      case "definition":
      case "footnoteDefinition":
      case "footnoteReference":
      case "html":
      case "imageReference":
      case "linkReference":
      case "mdxjsEsm":
      case "yaml":
        throw new Error(`Unsupported content node: ${node.type}`);
    }
  };
  return render(nodes);
};

const safeUrl = (url: string | undefined) => {
  const value = (url ?? "").trim();
  for (const character of url ?? "") {
    if (character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\")
      return "";
  }
  return value.length > 0 &&
    !value.startsWith("//") &&
    (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:https?:|mailto:)/i.test(value))
    ? value
    : "";
};
