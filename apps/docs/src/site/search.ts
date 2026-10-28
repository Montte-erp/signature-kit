import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as AsyncData from "foldkit/asyncData";
import * as Command from "foldkit/command";
import * as Dom from "foldkit/dom";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";

import { localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";
import { SearchIndex } from "../content/config.ts";

const SearchData = AsyncData.Schema(SearchIndex, Schema.Literals(["unavailable"]));

export const Model = Schema.Struct({
  locale: SiteLocale,
  query: Schema.String,
  open: Schema.Boolean,
  index: SearchData.schema,
});

export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedSearch: {},
  ClickedClose: {},
  ChangedQuery: { query: Schema.String },
  LoadedIndex: { index: SearchIndex },
  FailedIndex: {},
  OpenedDialog: {},
  ClosedDialog: {},
});

export type Message = typeof Message.Type;

const LoadIndex = Command.define("LoadSearchIndex", {
  args: { locale: SiteLocale },
  messages: [Message.LoadedIndex, Message.FailedIndex],
  execute: ({ locale }) =>
    HttpClient.get(`/${locale}/search.json`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchIndex)),
      Effect.match({
        onSuccess: (index) => Message.LoadedIndex({ index }),
        onFailure: () => Message.FailedIndex(),
      }),
    ),
});

const OpenDialog = Command.define("OpenSiteSearch", {
  messages: [Message.OpenedDialog],
  execute: Effect.gen(function* () {
    const installed = yield* Dom.showDialog("#site-search-dialog", {
      isModal: true,
      focusSelector: "#site-search-input",
    }).pipe(Effect.orDie);
    if (installed) yield* Dom.lockScroll;
    return Message.OpenedDialog();
  }),
});

const CloseDialog = Command.define("CloseSiteSearch", {
  messages: [Message.ClosedDialog],
  execute: Effect.gen(function* () {
    const released = yield* Dom.closeDialog("#site-search-dialog").pipe(Effect.orDie);
    if (released) yield* Dom.unlockScroll;
    return Message.ClosedDialog();
  }),
});

export const init = (locale: typeof SiteLocale.Type): Model => ({
  locale,
  query: "",
  open: false,
  index: SearchData.Idle(),
});

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, HttpClient.HttpClient> =>
  Message.match(message, {
    ClickedSearch: () => {
      const shouldLoad = AsyncData.isIdle(model.index) || AsyncData.isFailure(model.index);
      return {
        model: { ...model, open: true, index: shouldLoad ? SearchData.Loading() : model.index },
        commands: shouldLoad ? [OpenDialog(), LoadIndex({ locale: model.locale })] : [OpenDialog()],
      };
    },
    ClickedClose: () => ({ model: { ...model, open: false }, commands: [CloseDialog()] }),
    ChangedQuery: ({ query }) => ({ model: { ...model, query } }),
    LoadedIndex: ({ index }) => ({
      model: { ...model, index: SearchData.Success({ data: index }) },
    }),
    FailedIndex: () => ({
      model: { ...model, index: SearchData.Failure({ error: "unavailable" }) },
    }),
    OpenedDialog: () => ({ model }),
    ClosedDialog: () => ({ model }),
  });

const searchableText = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  const terms = searchableText(model.query)
    .trim()
    .split(/\s+/u)
    .filter((term) => term !== "");
  const documents = AsyncData.getOrElse(model.index, () => []);
  const results =
    terms.length === 0
      ? []
      : documents.filter((document) => {
          const text = searchableText(
            `${document.title} ${document.description ?? ""} ${document.text}`,
          );
          return terms.every((term) => text.includes(term));
        });
  const status = AsyncData.isPending(model.index)
    ? m.site_search_loading({}, options)
    : AsyncData.isFailure(model.index)
      ? m.site_search_error({}, options)
      : terms.length === 0
        ? m.site_search_prompt({}, options)
        : results.length === 0
          ? m.site_search_empty({}, options)
          : m.site_search_count({ count: results.length }, options);
  return h.div(
    [h.Class("site-search")],
    [
      h.button(
        [h.Id("site-search-trigger"), h.Type("button"), h.OnClick(Message.ClickedSearch())],
        [m.site_search({}, options)],
      ),
      h.dialog(
        [
          h.Id("site-search-dialog"),
          h.Class("search-dialog"),
          h.Open(model.open),
          h.Attribute("aria-labelledby", "site-search-title"),
          h.OnCancel(Message.ClickedClose()),
        ],
        [
          h.div(
            [h.Class("search-heading")],
            [
              h.h2([h.Id("site-search-title")], [m.site_search({}, options)]),
              h.button(
                [h.Type("button"), h.OnClick(Message.ClickedClose())],
                [m.site_search_close({}, options)],
              ),
            ],
          ),
          h.label([h.Attribute("for", "site-search-input")], [m.site_search({}, options)]),
          h.input([
            h.Id("site-search-input"),
            h.Type("search"),
            h.Value(model.query),
            h.OnInput((query) => Message.ChangedQuery({ query })),
          ]),
          h.p(
            [h.Attribute("role", AsyncData.isFailure(model.index) ? "alert" : "status")],
            [status],
          ),
          AsyncData.isFailure(model.index)
            ? h.button(
                [h.Type("button"), h.OnClick(Message.ClickedSearch())],
                [m.site_search_retry({}, options)],
              )
            : h.empty,
          h.ul(
            [h.Id("site-search-results")],
            results.map((result) =>
              h.li(
                [],
                [
                  h.a([h.Href(localizedSitePath(result.path, model.locale))], [result.title]),
                  result.description === undefined ? h.empty : h.p([], [result.description]),
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  );
});
