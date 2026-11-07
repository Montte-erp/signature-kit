import { Effect, Schema } from "effect";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import en from "../messages/en-US.json";
import pt from "../messages/pt-BR.json";
import * as Server from "foldkit/experimental/server";
import { Flags, init, createView } from "./main";
import { createArticleCatalog } from "./articles";
import { contentPaths, resolveContent } from "./content";
import { createFeeds } from "./feeds";
import { SearchQuery } from "./search";
import {
  captureServerEvent,
  captureServerEventWithoutRequestEffect,
  defaultServerAnalyticsLayer,
} from "../lib/posthog/server";
import { feedbackResponse } from "./feedback-server";
import { signFreeDescription, signFreeFaqs, signFreeSteps } from "./home";

export const createServerComposition = (
  source: {
    paths: typeof contentPaths;
    resolve: typeof resolveContent;
  },
  analytics = defaultServerAnalyticsLayer,
) => {
  const { articlePaths, articles, blogTags, tagPaths } = createArticleCatalog(source);
  const { feedResponse } = createFeeds(source);
  const view = createView(source);
  const prerenderPaths = [
    "/en-US",
    "/pt-BR",
    "/pt-BR/assine-documentos-gratis",
    "/en-US/sign-free",
    ...articlePaths(),
    ...tagPaths(),
    ...source
      .paths()
      .filter((path) => path.startsWith("docs/"))
      .map((path) => {
        const locale = path.endsWith(".pt-BR") ? "pt-BR" : "en-US";
        const slug = path.slice(5).replace(/\.pt-BR$/, "");
        return `/${locale}/docs${slug === "index" ? "" : `/${slug}`}`;
      }),
  ];
  const MetadataSchema = Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("meta"),
      key: Schema.String,
      value: Schema.String,
      property: Schema.Boolean,
    }),
    Schema.Struct({ kind: Schema.Literal("link"), language: Schema.String, href: Schema.String }),
  ]);
  type Metadata = typeof MetadataSchema.Type;

  const metadata = (application: Parameters<Server.DocumentRenderer>[0]) => {
    const url =
      application.canonical !== undefined && application.canonical !== ""
        ? new URL(application.canonical)
        : undefined;
    if (url === undefined) return undefined;
    const locale = application.lang === "pt-BR" ? "pt-BR" : "en-US";
    const match = /^\/(en-US|pt-BR)(\/.*)?$/.exec(url.pathname);
    const path = match?.[2] ?? "";
    const articleMatch = /^\/(blog|changelog)\/([^/]+)$/.exec(path);
    const section = articleMatch?.[1] === "blog" ? "blog" : "changelog";
    const slug =
      articleMatch !== null
        ? (articles(match?.[1] === "pt-BR" ? "pt-BR" : "en-US", section).find(
            (entry) => encodeURIComponent(entry.slug) === articleMatch[2],
          )?.slug ?? "")
        : "";
    const article =
      articleMatch !== null && slug !== "tags"
        ? source.resolve(match?.[1] === "pt-BR" ? "pt-BR" : "en-US", section, slug)
        : undefined;
    const docs =
      path === "/docs" || path.startsWith("/docs/")
        ? source.resolve(locale, "docs", path.slice(6))
        : undefined;
    const tagPath = path === "/blog/tags" || path.startsWith("/blog/tags/");
    const descriptions =
      locale === "pt-BR"
        ? {
            blog: "Artigos sobre assinaturas digitais, TypeScript e infraestrutura Effect-native.",
            tags: "Explore os artigos por assunto.",
            changelog: "Notas de versão dos pacotes SignatureKit.",
            signing:
              "Assine documentos PDF grátis no navegador com certificado digital A1. O arquivo, o .p12/.pfx e a senha ficam no seu dispositivo.",
          }
        : {
            blog: "Articles about digital signatures, TypeScript, and Effect-native infrastructure.",
            tags: "Explore articles by topic.",
            changelog: "Release notes for SignatureKit packages.",
            signing: "Sign PDF documents for free in your browser with an A1 certificate.",
          };
    const description =
      article?.description ??
      docs?.description ??
      (tagPath
        ? descriptions.tags
        : path === "/blog"
          ? descriptions.blog
          : path === "/changelog"
            ? descriptions.changelog
            : path === "/sign-free" || path === "/assine-documentos-gratis"
              ? descriptions.signing
              : path === "/search"
                ? locale === "pt-BR"
                  ? "Busque na documentação do SignatureKit."
                  : "Search the SignatureKit documentation."
                : path === ""
                  ? locale === "pt-BR"
                    ? "Uma fronteira tipada para certificados A1/PKCS#12, PDF/PAdES, XML-DSig e provedores remotos."
                    : "One typed signing boundary for A1/PKCS#12 certificates, PDF/PAdES, XML-DSig, and remote providers."
                  : locale === "pt-BR"
                    ? pt.hero_subhead
                    : en.hero_subhead);
    const meta = (key: string, value: string, property = false): Metadata => ({
      kind: "meta",
      key,
      value,
      property,
    });
    const link = (language: string, href: string): Metadata => ({ kind: "link", language, href });
    const candidates = (["en-US", "pt-BR"] satisfies ("en-US" | "pt-BR")[]).filter((candidate) => {
      if (article !== undefined) return Boolean(source.resolve(candidate, section, slug));
      if (tagPath && path !== "/blog/tags")
        return blogTags(candidate).some((tag) => encodeURIComponent(tag.slug) === path.slice(11));
      if (docs !== undefined) return Boolean(source.resolve(candidate, "docs", path.slice(6)));
      return true;
    });
    const alternatePath = (candidate: string) =>
      path === "/sign-free" || path === "/assine-documentos-gratis"
        ? candidate === "pt-BR"
          ? "/assine-documentos-gratis"
          : "/sign-free"
        : path;
    const alternate = (candidate: string) =>
      `https://signaturekit.dev/${candidate}${alternatePath(candidate)}`;
    const elements = [
      meta("og:site_name", "SignatureKit", true),
      meta("og:type", article !== undefined ? "article" : "website", true),
      meta("og:locale", locale === "pt-BR" ? "pt_BR" : "en_US", true),
      meta("og:title", application.title, true),
      meta(
        "og:image",
        `https://signaturekit.dev${url.pathname}${path === "" ? "/index" : ""}.webp`,
        true,
      ),
      meta("twitter:card", "summary"),
      meta("twitter:title", application.title),
      ...(description !== ""
        ? [
            meta("description", description),
            meta("og:description", description, true),
            meta("twitter:description", description),
          ]
        : []),
      ...candidates.map((candidate) => link(candidate, alternate(candidate))),
      ...(candidates.length > 0
        ? [
            link(
              "x-default",
              alternate(candidates.includes("en-US") ? "en-US" : (candidates[0] ?? "en-US")),
            ),
          ]
        : []),
      ...(path === "/search" || match?.[1] !== locale ? [meta("robots", "noindex")] : []),
    ];
    return { elements, description, locale };
  };
  const renderDocument: Server.DocumentRenderer = (application, assets) => {
    const data = metadata(application);
    if (data === undefined) return Server.renderDocument(application, assets);
    const document = new DOMImplementation().createDocument(null, "metadata", null);
    const serializer = new XMLSerializer();
    const head = data.elements
      .map((metadata) => {
        const element = document.createElement(metadata.kind);
        if (metadata.kind === "meta") {
          element.setAttribute(metadata.property ? "property" : "name", metadata.key);
          element.setAttribute("content", metadata.value);
        } else {
          element.setAttribute("rel", "alternate");
          element.setAttribute("hreflang", metadata.language);
          element.setAttribute("href", metadata.href);
        }
        return serializer.serializeToString(element);
      })
      .join("");
    const signFreeUrl = "https://signaturekit.dev/pt-BR/assine-documentos-gratis";
    const structuredData =
      application.canonical === signFreeUrl
        ? {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "SoftwareApplication",
                name: "SignatureKit — Assinador de PDF grátis",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                url: signFreeUrl,
                description: signFreeDescription,
                offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
              },
              {
                "@type": "HowTo",
                name: "Como assinar um documento PDF grátis com certificado A1",
                description: signFreeDescription,
                totalTime: "PT2M",
                step: signFreeSteps.map((step, index) => ({
                  "@type": "HowToStep",
                  position: index + 1,
                  name: step.title,
                  text: step.body,
                  url: `${signFreeUrl}#assinar`,
                })),
              },
              {
                "@type": "FAQPage",
                mainEntity: signFreeFaqs.map((item) => ({
                  "@type": "Question",
                  name: item.question,
                  acceptedAnswer: { "@type": "Answer", text: item.answer },
                })),
              },
            ],
          }
        : undefined;
    const jsonLd =
      structuredData === undefined
        ? ""
        : `<script type="application/ld+json">${JSON.stringify(structuredData).replaceAll("<", "\\u003c")}</script>`;
    return Server.renderDocument(application, assets, { head: head + jsonLd });
  };
  const renderPage = async (request: Request, buildId?: string): Promise<Server.EntryResult> => {
    const feedback = await Effect.runPromise(feedbackResponse(request));
    if (feedback !== undefined) return Server.Responded(feedback);
    const feed = await Effect.runPromise(feedResponse(request));
    if (feed !== undefined) {
      const match = /^\/(en-US|pt-BR)\/blog\/rss\.xml$/.exec(new URL(request.url).pathname);
      if (match !== null && feed.status === 200)
        await captureServerEvent("blog_rss_requested", request, { locale: match[1] });
      return Server.Responded(feed);
    }
    const path = new URL(request.url).pathname;
    const image = /^\/(en-US|pt-BR)(\/.*)\.webp$/.exec(path);
    if (image !== null) {
      const imagePath = image[2] === "/index" ? "" : image[2];
      const page = await renderPage(
        new Request(`https://signaturekit.dev/${image[1]}${imagePath}`),
        buildId,
      );
      if (page._tag !== "Rendered")
        return Server.Responded(new Response("Not found", { status: 404 }));
      if (request.method !== "GET" && request.method !== "HEAD")
        return Server.Responded(
          new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }),
        );
      const data = metadata(page.application);
      if (data === undefined) return Server.Responded(new Response("Not found", { status: 404 }));
      const { SocialImage, socialImageLayer } = await import("./social-image");
      const bytes = await Effect.runPromise(
        Effect.gen(function* () {
          const social = yield* SocialImage;
          return yield* social.render({
            title: page.application.title,
            description: data.description,
            site: "SignatureKit",
            locale: data.locale,
          });
        }).pipe(Effect.provide(socialImageLayer)),
        { signal: request.signal },
      );
      return Server.Responded(
        new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
          headers: { "Content-Type": "image/webp" },
        }),
      );
    }
    if (path === "/")
      return Server.Responded(Response.redirect(new URL("/en-US", request.url), 302));
    const match = /^\/(en-US|pt-BR)(\/.*)?$/.exec(path);
    if (match === null) return Server.Responded(new Response("Not found", { status: 404 }));
    const locale = match[1] === "pt-BR" ? "pt-BR" : "en-US";
    const route = match[2] ?? "";
    const docs = route === "/docs" || route.startsWith("/docs/");
    const section =
      route === "/blog" || route.startsWith("/blog/")
        ? "blog"
        : route === "/changelog" || route.startsWith("/changelog/")
          ? "changelog"
          : undefined;
    const signing =
      (locale === "pt-BR" && route === "/assine-documentos-gratis") ||
      (locale === "en-US" && route === "/sign-free");
    if (route !== "" && route !== "/search" && !docs && section === undefined && !signing)
      return Server.Responded(new Response("Not found", { status: 404 }));
    if (docs && source.resolve(locale, "docs", route.slice(6)) === undefined)
      return Server.Responded(new Response("Not found", { status: 404 }));
    const tagRoute = route === "/blog/tags" || route.startsWith("/blog/tags/");
    if (
      tagRoute &&
      route !== "/blog/tags" &&
      !blogTags(locale).some((tag) => encodeURIComponent(tag.slug) === route.slice(11))
    )
      return Server.Responded(new Response("Not found", { status: 404 }));
    if (
      section !== undefined &&
      !tagRoute &&
      route !== `/${section}` &&
      !articles(locale, section).some((entry) => entry.href === `/${locale}${route}`)
    )
      return Server.Responded(new Response("Not found", { status: 404 }));
    const rawQuery = route === "/search" ? (new URL(request.url).searchParams.get("q") ?? "") : "";
    if (route === "/search" && request.method === "GET" && analytics !== undefined)
      await Effect.runPromise(
        captureServerEventWithoutRequestEffect("search_requested", {
          query_present: rawQuery.length > 0,
          query_length: Math.min(rawQuery.length, 200),
        }).pipe(Effect.ignore, Effect.provide(analytics), Effect.orDie),
      );
    const decodedQuery = Schema.decodeUnknownOption(SearchQuery)(rawQuery);
    const query = decodedQuery._tag === "Some" ? decodedQuery.value : "";
    const application = await Effect.runPromise(
      Server.renderToString(
        { Flags, init, view },
        { flags: { locale, path: route, query }, buildId },
      ),
    );
    return Server.Rendered(application);
  };

  return { prerenderPaths, renderDocument, renderPage };
};
export const { prerenderPaths, renderDocument, renderPage } = createServerComposition({
  paths: contentPaths,
  resolve: resolveContent,
});
