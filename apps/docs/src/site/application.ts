import { autoDocumentsLayer } from "./auto-documents.ts";
import { Effect, Layer, Option, Schema } from "effect";
import * as Mount from "foldkit/mount";
import * as Command from "foldkit/command";
import type { Document, HtmlBuilder } from "foldkit/html";
import * as Update from "foldkit/update";
import * as Subscription from "foldkit/subscription";
import * as Http from "foldkit/http";
import { defineMessageUnion } from "foldkit/message";
import type { HttpClient } from "effect/http";

import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Preferences from "./preferences.ts";

import type { PdfPreview } from "./pdf-preview.ts";
import { signingSessionLayer } from "./signing-session.ts";
import type { SigningSession } from "./signing-session.ts";
import { signingIdentityLayer } from "./signing-identity.ts";
import type { SigningIdentity } from "./signing-identity.ts";
import * as Landing from "./landing.ts";
import * as FreeSigning from "./free-signing.ts";
import { signingImagesLayer } from "./signing-images.ts";
import type { SigningImages } from "./signing-images.ts";
import * as Search from "./search.ts";
import { ContentDiagrams, contentDiagramsBrowserLayer } from "./content-diagrams.ts";

import { freeSigningPath, localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";
import { ContentPage, DocumentationGroup } from "../content/config.ts";

export const ContentFlags = Schema.Struct({
  page: ContentPage,
  navigation: Schema.Array(DocumentationGroup),
  alternates: Schema.Array(SiteLocale),
  locale: SiteLocale,
  path: Schema.String,
  siteUrl: Schema.String,
});

export type ContentFlags = typeof ContentFlags.Type;

const ContentModel = Schema.Struct({
  ...ContentFlags.fields,
  search: Search.Model,
  preferences: Preferences.Model,
  landing: Landing.Model,
});
type ContentModel = typeof ContentModel.Type;
const Message = defineMessageUnion({
  MountedContent: {},
  RenderedDiagrams: {},
  GotLandingMessage: { message: Landing.Message },
  GotSearchMessage: { message: Search.Message },
  GotPreferencesMessage: { message: Preferences.Message },
});
type Message = typeof Message.Type;

const MountContent = Mount.define("MountPublishedContent", {
  messages: [Message.MountedContent],
  execute: () => Effect.succeed(Message.MountedContent()),
});

const RenderDiagrams = Command.define("RenderPublishedDiagrams", {
  messages: [Message.RenderedDiagrams],
  interrupt: true,
  execute: Effect.gen(function* () {
    const diagrams = yield* ContentDiagrams;
    const root = document.querySelector(".content-body");
    if (root !== null) yield* diagrams.render(root);
    return Message.RenderedDiagrams();
  }),
});

const foldLanding = Update.foldChild({
  update: Landing.update,
  read: (model: ContentModel) => Option.some(model.landing),
  write: (model, landing) => ({ ...model, landing }),
  toParentMessage: (message) => Message.GotLandingMessage({ message }),
});

const foldSearch = Update.foldChild({
  update: Search.update,
  read: (model: ContentModel) => Option.some(model.search),
  write: (model, search) => ({ ...model, search }),
  toParentMessage: (message) => Message.GotSearchMessage({ message }),
});

const foldPreferences = Update.foldChild({
  update: Preferences.update,
  read: (model: ContentModel) => Option.some(model.preferences),
  write: (model, preferences) => ({ ...model, preferences }),
  toParentMessage: (message) => Message.GotPreferencesMessage({ message }),
});

const view = (model: ContentModel, h: HtmlBuilder<Message>): Document => {
  const options = { locale: model.locale };
  const canonical = model.siteUrl + localizedSitePath(model.path, model.locale);
  return {
    title: `${model.page.title} — SignatureKit`,
    lang: model.locale,
    canonical,
    body: h.div(
      [h.Class("site")],
      [
        h.header(
          [h.Class("site-header")],
          [
            h.a(
              [h.Href(localizedSitePath("/", model.locale)), h.Class("site-brand")],
              ["SignatureKit"],
            ),
            h.submodel({
              slotId: "site-search",
              model: model.search,
              view: Search.view,
              toParentMessage: (message) => Message.GotSearchMessage({ message }),
            }),
            h.submodel({
              slotId: "site-preferences",
              model: model.preferences,
              view: Preferences.view,
              toParentMessage: (message) => Message.GotPreferencesMessage({ message }),
            }),
            h.nav(
              [h.Attribute("aria-label", m.site_main_navigation({}, options))],
              [
                h.a(
                  [h.Href(localizedSitePath("/docs", model.locale))],
                  [m.site_documentation({}, options)],
                ),
                h.a([h.Href(localizedSitePath("/blog", model.locale))], ["Blog"]),
                h.a([h.Href(localizedSitePath("/changelog", model.locale))], ["Changelog"]),
              ],
            ),
            h.nav(
              [
                h.Attribute("aria-label", m.locale_switcher_label({}, options)),
                h.Class("locale-switcher"),
              ],
              model.alternates.map((locale) =>
                h.a(
                  [
                    h.Href(localizedSitePath(model.path, locale)),
                    h.Lang(locale),
                    h.Attribute("hreflang", locale),
                    h.Attribute("aria-current", locale === model.locale ? "true" : "false"),
                  ],
                  [
                    locale === "pt-BR"
                      ? m.locale_name_pt({}, options)
                      : m.locale_name_en({}, options),
                  ],
                ),
              ),
            ),
          ],
        ),
        h.main(
          [
            h.Id("main-content"),
            h.Class(
              (model.path.startsWith("docs") ? "docs-layout" : "page-layout") +
                (model.page.headings.length > 0 ? " has-toc" : ""),
            ),
          ],
          [
            model.path.startsWith("docs")
              ? h.aside(
                  [h.Class("docs-sidebar")],
                  [
                    h.nav(
                      [h.Attribute("aria-label", m.site_doc_navigation({}, options))],
                      model.navigation.map((group) =>
                        h.section(
                          [],
                          [
                            h.h2([], [group.title]),
                            h.ul(
                              [],
                              group.items.map((item) =>
                                h.li(
                                  [],
                                  [
                                    h.a(
                                      [
                                        h.Href(localizedSitePath(item.path, model.locale)),
                                        h.Attribute(
                                          "aria-current",
                                          item.path === model.path ? "page" : "false",
                                        ),
                                      ],
                                      [item.title],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                )
              : h.empty,
            model.path === "" || model.path === freeSigningPath
              ? h.submodel({
                  slotId: "site-landing",
                  model: model.landing,
                  view: model.path === freeSigningPath ? FreeSigning.view : Landing.view,
                  toParentMessage: (message) => Message.GotLandingMessage({ message }),
                })
              : h.article(
                  [h.Class("content-page")],
                  [
                    h.h1([], [model.page.title]),
                    model.page.description === undefined
                      ? h.empty
                      : h.p([h.Class("content-description")], [model.page.description]),
                    h.div([
                      h.Class("content-body"),
                      h.InnerHTML(model.page.html),
                      h.OnMount(MountContent()),
                    ]),
                  ],
                ),
            model.page.headings.length === 0
              ? h.empty
              : h.aside(
                  [h.Class("page-toc")],
                  [
                    h.details(
                      [h.Open(true)],
                      [
                        h.summary([], [m.site_on_this_page({}, options)]),
                        h.nav(
                          [h.Attribute("aria-label", m.site_on_this_page({}, options))],
                          [
                            h.ul(
                              [],
                              model.page.headings.map((heading) =>
                                h.li(
                                  [h.DataAttribute("depth", heading.tag)],
                                  [h.a([h.Href("#" + heading.id)], [heading.title])],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
          ],
        ),
        h.footer([], ["SignatureKit · MIT"]),
      ],
    ),
  };
};

export const contentApplication = {
  Flags: ContentFlags,
  Model: ContentModel,
  subscriptions: Subscription.lift(Landing.subscriptions)<ContentModel, Message>({
    read: (model) => Option.some(model.landing),
    toParentMessage: (message) => Message.GotLandingMessage({ message }),
    when: (model) => model.path === "" || model.path === freeSigningPath,
  }),
  resources: Layer.mergeAll(
    Http.layer,
    BrowserKeyValueStore.layerLocalStorage,
    signingSessionLayer,
    autoDocumentsLayer,
    signingIdentityLayer,
    signingImagesLayer,
    contentDiagramsBrowserLayer,
    Clipboard.layer,
  ),
  init: (flags: ContentFlags): Update.Return<ContentModel, Message, KeyValueStore.KeyValueStore> =>
    Update.foldChildInit(Preferences.init(flags.locale), {
      toParentModel: (preferences) => ({
        ...flags,
        search: Search.init(flags.locale),
        landing: Landing.init(flags.locale, flags.path === freeSigningPath ? "inline" : "dialog"),
        preferences,
      }),
      toParentMessage: (message) => Message.GotPreferencesMessage({ message }),
    }),
  update: (
    model: ContentModel,
    message: Message,
  ): Update.Return<
    ContentModel,
    Message,
    | HttpClient.HttpClient
    | KeyValueStore.KeyValueStore
    | SigningSession
    | SigningIdentity
    | PdfPreview
    | SigningImages
    | ContentDiagrams
    | Clipboard.Clipboard
  > =>
    Message.match(message, {
      MountedContent: () => ({ model, commands: [RenderDiagrams()] }),
      RenderedDiagrams: () => ({ model }),
      GotLandingMessage: ({ message }) => foldLanding(model, message),
      GotSearchMessage: ({ message }) => foldSearch(model, message),
      GotPreferencesMessage: ({ message }) => foldPreferences(model, message),
    }),
  view,
};
