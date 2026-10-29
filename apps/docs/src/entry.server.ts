import { Effect, Schema } from "effect";
import * as Server from "foldkit/experimental/server";
import { defaultTreeAdapter, parseFragment } from "parse5";
import encodedContent from "virtual:signature-kit/content";
import { SiteContent, ContentFlags } from "./site/config.ts";
import { contentApplication } from "./site/application.ts";
import { contentDocument } from "./site/document.ts";
import { localizedSitePath } from "../lib/site-route.ts";
import { baseLocale } from "../paraglide/runtime.js";

const content = Schema.decodeUnknownSync(SiteContent)(encodedContent);
export const prerenderPaths = content.pages.map((page) =>
  localizedSitePath(page.path, page.locale),
);

export const renderDocument: Server.DocumentRenderer = (application, assets) => {
  const fragment = parseFragment(application.html);
  const payload = fragment.childNodes.find(
    (node) =>
      defaultTreeAdapter.isElementNode(node) &&
      node.tagName === "script" &&
      node.attrs.some((attribute) => attribute.name === Server.FOLDKIT_FLAGS_ATTRIBUTE),
  );
  const json =
    payload !== undefined && defaultTreeAdapter.isElementNode(payload)
      ? payload.childNodes
          .filter(defaultTreeAdapter.isTextNode)
          .map((node) => node.value)
          .join("")
      : undefined;
  const flags = Schema.decodeUnknownSync(Schema.fromJsonString(ContentFlags))(json);
  return contentDocument(application, assets, flags);
};

export const renderPage = (request: Request): Promise<Server.EntryResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return Server.Responded(
          new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }),
        );
      }
      const url = new URL(request.url);
      if (url.pathname === "/")
        return Server.Responded(Response.redirect(new URL(`/${baseLocale}`, url), 307));
      const asset = content.assets.find((candidate) => "/" + candidate.fileName === url.pathname);
      if (asset !== undefined)
        return Server.Responded(
          new Response(request.method === "HEAD" ? null : asset.source, {
            headers: { "Content-Type": asset.contentType },
          }),
        );
      const flags = content.pages.find(
        (page) => localizedSitePath(page.path, page.locale) === url.pathname,
      );
      if (flags === undefined) return Server.Responded(new Response("Not found", { status: 404 }));
      const application = yield* Server.renderToString(contentApplication, { flags });
      return Server.Rendered(application);
    }),
  );
