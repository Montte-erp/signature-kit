import { Schema } from "effect";
import * as Mount from "foldkit/mount";
import type { Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import en from "../messages/en-US.json";
import pt from "../messages/pt-BR.json";
import { createArticleCatalog } from "./articles";
import { signingView } from "./signing-view";
import { homeDemo } from "./home-demo";
import { contentPaths, docsNavigation, renderContent, resolveContent } from "./content";
import { SearchQuery, SearchResults, searchDocs } from "./search";
import { SubmitFeedback, SubmitTextFeedback } from "./feedback";
import {
  CopyHome,
  ExpireHomeCopy,
  SelectHomeProvider,
  SaveTheme,
  Theme,
  ThemeMount,
  HomeCopyTarget,
  HomeCopyLocation,
  HomeCopyRequest,
  HomeProvider,
  firstSignature,
  homeProviders,
  homeView,
  installCommand,
  signFreeLanding,
} from "./home";

export const Flags = Schema.Struct({
  locale: Schema.Literals(["en-US", "pt-BR"]),
  path: Schema.String,
  query: Schema.optional(SearchQuery),
});
export const Model = Schema.Struct({
  locale: Flags.fields.locale,
  path: Schema.String,
  menuOpen: Schema.Boolean,
  theme: Theme,
  query: SearchQuery,
  results: SearchResults,
  feedbackStatus: Schema.Literals(["idle", "sending", "success", "error"]),
  homeProvider: HomeProvider,
  homeCopied: Schema.Union([HomeCopyTarget, Schema.Literals(["none", "failed"])]),
  homeCopyRequest: HomeCopyRequest,
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  ToggledLanguageMenu: {},
  ThemeToggled: {},
  ThemeLoaded: { theme: Theme },
  ThemeSaved: {},
  SigningMounted: {},
  DemoMounted: {},
  HomeProviderRequested: { provider: HomeProvider },
  HomeProviderSelected: { provider: HomeProvider },
  HomeCopyRequested: { target: HomeCopyTarget, location: HomeCopyLocation },
  HomeCopyFinished: {
    target: HomeCopyTarget,
    request: HomeCopyRequest,
    provider: HomeProvider,
    ok: Schema.Boolean,
  },
  HomeCopyExpired: { request: HomeCopyRequest, provider: HomeProvider },
  QueryChanged: { value: Schema.String },
  SearchSubmitted: {},
  TextFeedbackSubmitted: {},
  FeedbackSubmitted: { opinion: Schema.Literals(["good", "bad"]) },
  FeedbackFinished: { ok: Schema.Boolean },
});
export type Message = typeof Message.Type;
export const init = (flags: typeof Flags.Type): { model: Model } => ({
  model: {
    locale: flags.locale,
    path: flags.path,
    menuOpen: false,
    theme: "light",
    query: flags.query ?? "",
    results: searchDocs(flags.locale, flags.query ?? ""),
    feedbackStatus: "idle",
    homeProvider: "Clicksign",
    homeCopied: "none",
    homeCopyRequest: 0,
  },
});
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SigningMounted: () => ({ model }),
    DemoMounted: () => ({ model }),
    HomeProviderRequested: ({ provider }) => ({
      model: {
        ...model,
        homeProvider: provider,
        homeCopied: "none",
        homeCopyRequest: model.homeCopyRequest + 1,
      },
      commands: [SelectHomeProvider({ provider })],
    }),
    HomeProviderSelected: () => ({ model }),
    HomeCopyRequested: ({ target, location }) => {
      const provider = homeProviders.find((entry) => entry.name === model.homeProvider);
      const snippets: Record<typeof HomeCopyTarget.Type, string> = {
        install: installCommand,
        npm: "npm install @signature-kit/signatures @signature-kit/a1",
        pnpm: "pnpm add @signature-kit/signatures @signature-kit/a1",
        yarn: "yarn add @signature-kit/signatures @signature-kit/a1",
        first: firstSignature,
        provider: provider?.code ?? "",
      };
      const text = snippets[target];
      return {
        model: { ...model, homeCopied: "none", homeCopyRequest: model.homeCopyRequest + 1 },
        commands: [
          CopyHome({
            text,
            target,
            location,
            provider: model.homeProvider,
            filename: provider?.filename ?? "",
            request: model.homeCopyRequest + 1,
          }),
        ],
      };
    },
    HomeCopyFinished: ({ target, ok, request, provider }) =>
      request !== model.homeCopyRequest || provider !== model.homeProvider
        ? { model }
        : {
            model: { ...model, homeCopied: ok ? target : "failed" },
            commands: [ExpireHomeCopy({ request, provider })],
          },
    HomeCopyExpired: ({ request, provider }) => ({
      model:
        request === model.homeCopyRequest && provider === model.homeProvider
          ? { ...model, homeCopied: "none" }
          : model,
    }),
    TextFeedbackSubmitted: () => ({
      model: { ...model, feedbackStatus: "sending" },
      commands: [SubmitTextFeedback({ route: `/${model.locale}${model.path}` })],
    }),
    FeedbackSubmitted: ({ opinion }) => ({
      model: { ...model, feedbackStatus: "sending" },
      commands: [SubmitFeedback({ route: `/${model.locale}${model.path}`, opinion })],
    }),
    FeedbackFinished: ({ ok }) => ({
      model: { ...model, feedbackStatus: ok ? "success" : "error" },
    }),
    QueryChanged: ({ value }) => {
      const query = value.slice(0, 200);
      return { model: { ...model, query, results: searchDocs(model.locale, query) } };
    },
    SearchSubmitted: () => ({
      model: { ...model, results: searchDocs(model.locale, model.query) },
    }),
    ToggledLanguageMenu: () => ({ model: { ...model, menuOpen: !model.menuOpen } }),
    ThemeToggled: () => {
      const theme = model.theme === "light" ? "dark" : "light";
      return { model: { ...model, theme }, commands: [SaveTheme({ theme })] };
    },
    ThemeLoaded: ({ theme }) => ({ model: { ...model, theme } }),
    ThemeSaved: () => ({ model }),
  });
export const createView = (source: {
  paths: typeof contentPaths;
  resolve: typeof resolveContent;
}) => {
  const { articles, blogTags, resolveArticle } = createArticleCatalog(source);
  return (model: Model, h: HtmlBuilder<Message>): Document => {
    const copy = model.locale === "pt-BR" ? pt : en;

    const signing =
      (model.locale === "pt-BR" && model.path === "/assine-documentos-gratis") ||
      (model.locale === "en-US" && model.path === "/sign-free");
    const docs = model.path === "/docs" || model.path.startsWith("/docs/");
    const content = docs ? source.resolve(model.locale, "docs", model.path.slice(6)) : undefined;
    const section =
      model.path === "/blog" || model.path.startsWith("/blog/")
        ? "blog"
        : model.path === "/changelog" || model.path.startsWith("/changelog/")
          ? "changelog"
          : undefined;
    const tagRoute = model.path === "/blog/tags" || model.path.startsWith("/blog/tags/");
    const tag =
      tagRoute && model.path !== "/blog/tags"
        ? blogTags(model.locale).find(
            (entry) => encodeURIComponent(entry.slug) === model.path.slice(11),
          )
        : undefined;
    const articleSlug =
      section !== undefined
        ? articles(model.locale, section).find(
            (entry) => entry.href === `/${model.locale}${model.path}`,
          )?.slug
        : undefined;
    const article =
      section !== undefined && articleSlug !== undefined && articleSlug !== "" && !tagRoute
        ? resolveArticle(model.locale, section, articleSlug)
        : undefined;
    const sourceLocale =
      article !== undefined &&
      model.locale === "pt-BR" &&
      section !== undefined &&
      source.resolve("pt-BR", section, articleSlug ?? "") === undefined
        ? "en-US"
        : model.locale;
    const canonical = `https://signaturekit.dev/${sourceLocale}${model.path}`;
    const searchSuffix =
      model.path === "/search" && model.query !== ""
        ? `?${new URLSearchParams({ q: model.query })}`
        : "";
    const languagePath = (locale: "en-US" | "pt-BR") => {
      if (signing) return locale === "pt-BR" ? "/assine-documentos-gratis" : "/sign-free";
      if (
        tagRoute &&
        model.path !== "/blog/tags" &&
        !blogTags(locale).some((entry) => encodeURIComponent(entry.slug) === model.path.slice(11))
      )
        return "/blog/tags";
      return model.path;
    };
    const heading = section === "blog" ? "Blog" : "Changelog";
    return {
      title: tagRoute
        ? `${tag?.tag ?? (model.locale === "pt-BR" ? "Tags do blog" : "Blog tags")} | SignatureKit`
        : signing
          ? model.locale === "pt-BR"
            ? "Assine documentos grátis com certificado A1 | SignatureKit"
            : "Sign documents for free — SignatureKit"
          : article !== undefined
            ? `${article.title} — SignatureKit`
            : section !== undefined
              ? `${heading} — SignatureKit`
              : content !== undefined
                ? `${content.title} — SignatureKit`
                : model.locale === "pt-BR"
                  ? "SignatureKit — Assinaturas digitais nativas em Effect para TypeScript"
                  : "SignatureKit — Effect-native digital signatures for TypeScript",
      lang: model.locale,
      canonical,
      ogUrl: canonical,
      body: h.div(
        [
          h.Class("site"),
          h.Attribute("data-theme", model.theme),
          h.OnMount(Mount.mapMessage(ThemeMount(), ({ theme }) => Message.ThemeLoaded({ theme }))),
        ],
        [
          h.header(
            [h.Class("header")],
            [
              h.a([h.Class("brand"), h.Href(`/${model.locale}`)], ["SignatureKit"]),
              h.nav(
                [h.Class("navigation")],
                [
                  h.a([h.Href(`/${model.locale}#providers`)], [copy.nav_providers]),
                  h.a(
                    [h.Href(`/${model.locale}#capabilities`)],
                    [model.locale === "pt-BR" ? "Recursos" : "Capabilities"],
                  ),
                  h.a([h.Href(`/${model.locale}/docs`)], [copy.hero_cta_docs]),
                  h.a(
                    [h.Href(`/${model.locale}/search`)],
                    [model.locale === "pt-BR" ? "Buscar" : "Search"],
                  ),
                  h.a([h.Href(`/${model.locale}/blog`)], ["Blog"]),
                  h.a([h.Href(`/${model.locale}/changelog`)], ["Changelog"]),
                  h.a([h.Href("https://github.com/Licitei/signature-kit")], ["GitHub"]),
                  h.button(
                    [
                      h.Type("button"),
                      h.OnClick(Message.ThemeToggled()),
                      h.Attribute(
                        "aria-label",
                        model.locale === "pt-BR" ? "Alternar tema" : "Toggle theme",
                      ),
                    ],
                    [model.theme === "light" ? "☾" : "☀"],
                  ),
                  h.button(
                    [h.Class("language"), h.OnClick(Message.ToggledLanguageMenu())],
                    [model.locale],
                  ),
                  model.menuOpen
                    ? h.div(
                        [h.Class("languages")],
                        [
                          h.a(
                            [
                              h.Href(`/en-US${languagePath("en-US")}${searchSuffix}`),
                              h.Lang("en-US"),
                            ],
                            ["English"],
                          ),
                          h.a(
                            [
                              h.Href(`/pt-BR${languagePath("pt-BR")}${searchSuffix}`),
                              h.Lang("pt-BR"),
                            ],
                            ["Português"],
                          ),
                        ],
                      )
                    : null,
                ],
              ),
            ],
          ),
          h.main(
            [],
            model.path === "/search"
              ? [
                  h.section(
                    [h.Class("docs-content")],
                    [
                      h.h1(
                        [],
                        [
                          model.locale === "pt-BR"
                            ? "Buscar na documentação"
                            : "Search documentation",
                        ],
                      ),
                      h.form(
                        [
                          h.Attribute("method", "get"),
                          h.Attribute("action", `/${model.locale}/search`),
                          h.Attribute("role", "search"),
                          h.OnSubmit(Message.SearchSubmitted()),
                        ],
                        [
                          h.label(
                            [],
                            [
                              model.locale === "pt-BR" ? "Termos de busca" : "Search terms",
                              h.input([
                                h.Type("search"),
                                h.Name("q"),
                                h.Value(model.query),
                                h.Attribute("maxlength", "200"),
                                h.Class("ph-no-capture"),
                                h.OnInput((value) => Message.QueryChanged({ value })),
                              ]),
                            ],
                          ),
                          h.button(
                            [h.Type("submit")],
                            [model.locale === "pt-BR" ? "Buscar" : "Search"],
                          ),
                        ],
                      ),
                      model.query.trim() === ""
                        ? h.p(
                            [],
                            [
                              model.locale === "pt-BR"
                                ? "Digite um termo para buscar."
                                : "Enter a search term.",
                            ],
                          )
                        : model.results.length === 0
                          ? h.p(
                              [],
                              [
                                model.locale === "pt-BR"
                                  ? "Nenhum resultado encontrado."
                                  : "No results found.",
                              ],
                            )
                          : h.ul(
                              [],
                              model.results.map((result) =>
                                h.li(
                                  [],
                                  [
                                    h.a(
                                      [h.Href(result.href)],
                                      [
                                        result.title,
                                        ...(result.heading !== "" ? [` — ${result.heading}`] : []),
                                      ],
                                    ),
                                    h.p([], [result.excerpt]),
                                  ],
                                ),
                              ),
                            ),
                    ],
                  ),
                ]
              : tagRoute
                ? [
                    h.article(
                      [h.Class("docs-content")],
                      [
                        h.h1(
                          [],
                          [
                            tag !== undefined
                              ? tag.tag
                              : model.locale === "pt-BR"
                                ? "Tags do blog"
                                : "Blog tags",
                          ],
                        ),
                        h.p(
                          [],
                          [
                            model.locale === "pt-BR"
                              ? "Explore os artigos por assunto."
                              : "Explore articles by topic.",
                          ],
                        ),
                        h.ul(
                          [],
                          tag !== undefined
                            ? tag.entries.map((entry) =>
                                h.li([], [h.a([h.Href(entry.href)], [entry.title])]),
                              )
                            : blogTags(model.locale).map((entry) =>
                                h.li(
                                  [],
                                  [
                                    h.a(
                                      [
                                        h.Href(
                                          `/${model.locale}/blog/tags/${encodeURIComponent(entry.slug)}`,
                                        ),
                                      ],
                                      [entry.tag],
                                    ),
                                  ],
                                ),
                              ),
                        ),
                      ],
                    ),
                  ]
                : signing
                  ? [
                      h.div(
                        [h.Class("ph-no-capture"), h.Attribute("data-analytics-sensitive", "true")],
                        model.locale === "pt-BR"
                          ? signFreeLanding(
                              h,
                              signingView(h, Message.SigningMounted(), model.locale),
                            )
                          : [signingView(h, Message.SigningMounted(), model.locale)],
                      ),
                    ]
                  : section !== undefined
                    ? [
                        h.article(
                          [h.Class("docs-content")],
                          article !== undefined
                            ? [
                                h.h1([], [article.title]),
                                ...(article.date !== "" ? [h.p([], [article.date])] : []),
                                ...(article.description !== undefined && article.description !== ""
                                  ? [h.p([], [article.description])]
                                  : []),
                                ...renderContent(article.nodes, h),
                              ]
                            : [
                                h.h1([], [heading]),
                                ...(section === "blog"
                                  ? [
                                      h.a(
                                        [h.Href(`/${model.locale}/blog/tags`)],
                                        [model.locale === "pt-BR" ? "Tags do blog" : "Blog tags"],
                                      ),
                                    ]
                                  : []),
                                h.p(
                                  [],
                                  [
                                    section === "blog"
                                      ? model.locale === "pt-BR"
                                        ? "Artigos sobre assinaturas digitais e SignatureKit."
                                        : "Articles about digital signatures and SignatureKit."
                                      : model.locale === "pt-BR"
                                        ? "Notas de versão dos pacotes SignatureKit."
                                        : "Release notes for SignatureKit packages.",
                                  ],
                                ),
                                h.ul(
                                  [],
                                  articles(model.locale, section).map((entry) =>
                                    h.li(
                                      [],
                                      [
                                        h.a([h.Href(entry.href)], [entry.title]),
                                        ...(entry.date !== "" ? [h.p([], [entry.date])] : []),
                                        ...(entry.description !== undefined &&
                                        entry.description !== ""
                                          ? [h.p([], [entry.description])]
                                          : []),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                        ),
                      ]
                    : docs && content !== undefined
                      ? [
                          h.div(
                            [h.Class("docs-layout")],
                            [
                              h.nav(
                                [h.Class("docs-navigation")],
                                docsNavigation(model.locale).map((group) =>
                                  h.section(
                                    [],
                                    [
                                      h.h2([], [group.title]),
                                      h.ul(
                                        [],
                                        group.links.map((link) =>
                                          h.li([], [h.a([h.Href(link.href)], [link.title])]),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              h.article(
                                [h.Class("docs-content")],
                                [
                                  h.div(
                                    [h.Attribute("data-feedback-content", "")],
                                    [
                                      h.h1([], [content.title]),
                                      ...(content.description !== undefined &&
                                      content.description !== ""
                                        ? [h.p([], [content.description])]
                                        : []),
                                      ...renderContent(content.nodes, h),
                                    ],
                                  ),
                                  h.section(
                                    [
                                      h.Class("ph-no-capture"),
                                      h.Attribute("data-analytics-sensitive", "true"),
                                    ],
                                    [
                                      h.h2(
                                        [],
                                        [
                                          model.locale === "pt-BR"
                                            ? "Como está este guia?"
                                            : "How is this guide?",
                                        ],
                                      ),
                                      h.textarea([
                                        h.Attribute("data-feedback-message", ""),
                                        h.Attribute("maxlength", "2000"),
                                        h.Attribute(
                                          "aria-label",
                                          model.locale === "pt-BR" ? "Comentário" : "Comment",
                                        ),
                                      ]),
                                      h.button(
                                        [
                                          h.Type("button"),
                                          h.OnClick(Message.FeedbackSubmitted({ opinion: "good" })),
                                        ],
                                        [model.locale === "pt-BR" ? "Bom" : "Good"],
                                      ),
                                      h.button(
                                        [
                                          h.Type("button"),
                                          h.OnClick(Message.FeedbackSubmitted({ opinion: "bad" })),
                                        ],
                                        [model.locale === "pt-BR" ? "Ruim" : "Bad"],
                                      ),
                                      h.button(
                                        [
                                          h.Type("button"),
                                          h.OnClick(Message.TextFeedbackSubmitted()),
                                        ],
                                        [
                                          model.locale === "pt-BR"
                                            ? "Enviar sobre texto selecionado"
                                            : "Send about selected text",
                                        ],
                                      ),
                                      h.p(
                                        [h.Attribute("role", "status")],
                                        [
                                          model.feedbackStatus === "success"
                                            ? model.locale === "pt-BR"
                                              ? "Obrigado pelo feedback!"
                                              : "Thank you for your feedback!"
                                            : model.feedbackStatus === "error"
                                              ? model.locale === "pt-BR"
                                                ? "Não foi possível enviar. Tente novamente."
                                                : "Could not send feedback. Please try again."
                                              : model.feedbackStatus === "sending"
                                                ? model.locale === "pt-BR"
                                                  ? "Enviando…"
                                                  : "Sending…"
                                                : "",
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ]
                      : [
                          ...homeView(
                            h,
                            {
                              locale: model.locale,
                              provider: model.homeProvider,
                              copied: model.homeCopied,
                            },
                            signingView(h, Message.SigningMounted(), model.locale),
                            homeDemo(h, model.locale, Message.DemoMounted()),
                            {
                              select: (provider) => Message.HomeProviderRequested({ provider }),
                              copy: (target, location) =>
                                Message.HomeCopyRequested({ target, location }),
                            },
                          ),
                        ],
          ),
          h.footer(
            [h.Class("footer")],
            [
              h.div([], [h.strong([], ["SignatureKit"]), h.p([], [copy.footer_brand_blurb])]),
              h.nav(
                [h.Attribute("aria-label", copy.footer_col_docs)],
                [
                  h.a(
                    [h.Href(`/${model.locale}/docs/get-started/quickstart`)],
                    [copy.footer_link_quickstart],
                  ),
                  h.a(
                    [h.Href(`/${model.locale}/docs/signing/signers`)],
                    [copy.footer_link_signing_boundary],
                  ),
                  h.a([h.Href(`/${model.locale}/docs/signing/pdf`)], [copy.footer_link_pdf]),
                  h.a([h.Href(`/${model.locale}/docs/signing/xml`)], [copy.footer_link_xml]),
                  h.a([h.Href(`/${model.locale}/docs/signing/errors`)], [copy.footer_link_errors]),
                ],
              ),
              h.nav(
                [h.Attribute("aria-label", copy.footer_col_project)],
                [
                  h.a(
                    [h.Href(`/${model.locale}/docs/providers/request-shape`)],
                    [copy.footer_col_providers],
                  ),
                  h.a([h.Href(`/${model.locale}/blog`)], [copy.footer_link_blog]),
                  h.a([h.Href(`/${model.locale}/changelog`)], ["Changelog"]),
                  h.a(
                    [h.Href("https://github.com/Licitei/signature-kit")],
                    [copy.footer_link_github],
                  ),
                  h.a(
                    [h.Href("https://github.com/Licitei/signature-kit/issues")],
                    [copy.footer_link_issues],
                  ),
                ],
              ),
              h.p(
                [],
                [
                  copy.footer_attribution_prefix,
                  " ",
                  h.a([h.Href("https://licitei.com.br")], ["Licitei"]),
                  " · ",
                  copy.footer_copyright,
                ],
              ),
            ],
          ),
        ],
      ),
    };
  };
};
export const view = createView({ paths: contentPaths, resolve: resolveContent });
