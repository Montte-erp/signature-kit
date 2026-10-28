import { Effect, Match, Schema } from "effect";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { toString } from "hast-util-to-string";
import { defaultHandlers } from "mdast-util-to-hast";
import type { Code } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";
import { visit } from "unist-util-visit";
import { unified } from "unified";
import { parse } from "yaml";

import { signatureKitErrorCatalog } from "@signature-kit/signatures";

import type { ContentCompilation } from "./config.ts";
import { ContentHeading, ContentHeadingTag, ContentMetadata } from "./config.ts";
import { CodeLanguage, ContentHighlighter } from "./highlight.ts";

const compiler = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkMdx)
  .use(remarkGfm)
  .use(remarkRehype, {
    handlers: {
      code: (state, node: Code) =>
        node.data?.hChildren === undefined
          ? defaultHandlers.code(state, node)
          : {
              type: "element",
              tagName: "figure",
              properties: { className: ["code-block"] },
              children: node.data.hChildren,
            },
    },
  })
  .use(rehypeSlug)
  .use(rehypeStringify);

export const compileContent = Effect.fn(function* (source: string) {
  const tree = compiler.parse(source);
  const frontmatter = tree.children.find((node) => node.type === "yaml");
  if (frontmatter === undefined) return yield* Effect.die("Content requires YAML metadata");
  const metadata = yield* Schema.decodeUnknownEffect(ContentMetadata)(parse(frontmatter.value));
  const bodyOffset = frontmatter.position?.end.offset;
  if (bodyOffset === undefined)
    return yield* Effect.die("The content parser must locate its metadata boundary");
  const components: Array<MdxJsxFlowElement | MdxJsxTextElement> = [];
  const expressions: string[] = [];
  visit(tree, (node) => {
    if (
      node.type === "mdxjsEsm" ||
      node.type === "mdxFlowExpression" ||
      node.type === "mdxTextExpression"
    )
      expressions.push(node.type);
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement")
      components.push(node);
  });
  yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Never))(expressions);
  yield* Effect.forEach(
    components,
    (node) =>
      Effect.gen(function* () {
        const name = yield* Schema.decodeUnknownEffect(
          Schema.Literals(["Cards", "Card", "Callout", "Steps", "Step", "ErrorCatalog"]),
        )(node.name);
        const attributes = Object.fromEntries(
          node.attributes.map((attribute) =>
            attribute.type === "mdxJsxAttribute"
              ? [attribute.name, attribute.value]
              : ["unsupportedSpread", null],
          ),
        );
        const properties = yield* Schema.decodeUnknownEffect(
          Schema.Record(Schema.String, Schema.String),
        )(attributes);
        const tag = Match.value(name).pipe(
          Match.when("Cards", () => "div"),
          Match.when("Card", () => "a"),
          Match.when("Callout", () => "aside"),
          Match.when("Steps", () => "div"),
          Match.when("Step", () => "section"),
          Match.when("ErrorCatalog", () => "table"),
          Match.exhaustive,
        );
        node.data = {
          ...node.data,
          hName: tag,
          hProperties: {
            className: ["content-" + name.toLowerCase()],
            ...(properties.href === undefined ? {} : { href: properties.href }),
            ...(properties.type === undefined ? {} : { "data-type": properties.type }),
          },
        };
        if (name === "ErrorCatalog") {
          node.data.hChildren = [
            {
              type: "element",
              tagName: "thead",
              properties: {},
              children: [
                {
                  type: "element",
                  tagName: "tr",
                  properties: {},
                  children: [
                    {
                      type: "element",
                      tagName: "th",
                      properties: {},
                      children: [{ type: "text", value: "Code" }],
                    },
                    {
                      type: "element",
                      tagName: "th",
                      properties: {},
                      children: [{ type: "text", value: "Default message" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "element",
              tagName: "tbody",
              properties: {},
              children: signatureKitErrorCatalog.map((entry) => ({
                type: "element",
                tagName: "tr",
                properties: { id: entry.code.replace("signature-kit.", "err-") },
                children: [
                  {
                    type: "element",
                    tagName: "td",
                    properties: {},
                    children: [
                      {
                        type: "element",
                        tagName: "code",
                        properties: {},
                        children: [{ type: "text", value: entry.code }],
                      },
                    ],
                  },
                  {
                    type: "element",
                    tagName: "td",
                    properties: {},
                    children: [
                      {
                        type: "text",
                        value: entry.message + (entry.overridable ? " · editable" : ""),
                      },
                    ],
                  },
                ],
              })),
            },
          ];
        }
        if (properties.description !== undefined && node.type === "mdxJsxFlowElement") {
          node.children.push({
            type: "paragraph",
            children: [{ type: "text", value: properties.description }],
          });
        }
        if (properties.description !== undefined && node.type === "mdxJsxTextElement") {
          node.children.push({ type: "text", value: " " + properties.description });
        }
        if (properties.title !== undefined && node.type === "mdxJsxTextElement") {
          node.children.unshift(
            { type: "strong", children: [{ type: "text", value: properties.title }] },
            { type: "text", value: " " },
          );
        }
        if (properties.title !== undefined && node.type === "mdxJsxFlowElement") {
          node.children.unshift({
            type: "paragraph",
            children: [{ type: "strong", children: [{ type: "text", value: properties.title }] }],
          });
        }
      }),
    { discard: true },
  );
  visit(tree, "paragraph", (node) => {
    if (node.children.some((child) => child.type === "mdxJsxTextElement")) {
      node.data = { ...node.data, hName: "div" };
    }
  });
  const codeBlocks: Code[] = [];
  visit(tree, "code", (node) => {
    codeBlocks.push(node);
  });
  yield* Effect.forEach(
    codeBlocks,
    (node) =>
      Effect.gen(function* () {
        if (node.lang === "mermaid" || node.lang === "package-install") return;
        const language = yield* Schema.decodeUnknownEffect(CodeLanguage)(node.lang ?? "text");
        const highlighter = yield* ContentHighlighter;
        const highlighted = yield* highlighter.highlight(node.value, language);
        node.data = { ...node.data, hName: "div", hChildren: highlighted };
      }),
    { discard: true },
  );
  const document = yield* Effect.promise(() => compiler.run(tree));
  const headingNodes: unknown[] = [];
  visit(document, "element", (node) => {
    if (Schema.is(ContentHeadingTag)(node.tagName)) {
      headingNodes.push({ tag: node.tagName, id: node.properties.id, title: toString(node) });
    }
  });
  const headings = yield* Schema.decodeUnknownEffect(Schema.Array(ContentHeading))(headingNodes);
  const html = compiler.stringify(document);
  const content: ContentCompilation = {
    ...metadata,
    html,
    headings,
    text: toString(document),
    markdown: source.slice(bodyOffset).trim(),
  };
  return content;
});
