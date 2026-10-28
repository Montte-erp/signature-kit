import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Command from "foldkit/command";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";

import { localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";
import { ContentDocument } from "../content/config.ts";

const Flags = Schema.Struct({
  locale: SiteLocale,
  path: Schema.String,
  sourceUrl: ContentDocument.fields.sourceUrl,
});
export const Model = Schema.Struct({
  ...Flags.fields,
  revision: Schema.Int,
  copied: Schema.Boolean,
  failed: Schema.Boolean,
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  ClickedCopy: {},
  CopiedMarkdown: { revision: Schema.Int },
  RejectedCopy: { revision: Schema.Int },
  ClearedCopy: { revision: Schema.Int },
});
export type Message = typeof Message.Type;

const CopyMarkdown = Command.define("CopyDocumentationMarkdown", {
  args: { url: Schema.String, revision: Schema.Int },
  messages: [Message.CopiedMarkdown, Message.RejectedCopy],
  execute: ({ url, revision }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* HttpClient.get(url).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
        );
        const text = yield* response.text;
        const clipboard = yield* Clipboard.Clipboard;
        yield* clipboard.writeString(text);
      }),
    ).pipe(
      Effect.timeout(Duration.seconds(10)),
      Effect.match({
        onSuccess: () => Message.CopiedMarkdown({ revision }),
        onFailure: () => Message.RejectedCopy({ revision }),
      }),
    ),
});
const ClearCopy = Command.define("ClearMarkdownCopyFeedback", {
  args: { revision: Schema.Int },
  messages: [Message.ClearedCopy],
  execute: ({ revision }) =>
    Effect.sleep(Duration.millis(1800)).pipe(Effect.as(Message.ClearedCopy({ revision }))),
});

export const init = (flags: typeof Flags.Type): Model => ({
  locale: flags.locale,
  path: flags.path,
  sourceUrl: flags.sourceUrl,
  revision: 0,
  copied: false,
  failed: false,
});
export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, HttpClient.HttpClient | Clipboard.Clipboard> =>
  Message.match<Update.Return<Model, Message, HttpClient.HttpClient | Clipboard.Clipboard>>(
    message,
    {
      ClickedCopy: () => {
        const revision = model.revision + 1;
        return {
          model: { ...model, revision, copied: false, failed: false },
          commands: [
            CopyMarkdown({ url: localizedSitePath(model.path, model.locale) + ".md", revision }),
          ],
        };
      },
      CopiedMarkdown: ({ revision }) =>
        revision !== model.revision
          ? { model }
          : {
              model: { ...model, copied: true, failed: false },
              commands: [ClearCopy({ revision })],
            },
      RejectedCopy: ({ revision }) => ({
        model: revision !== model.revision ? model : { ...model, copied: false, failed: true },
      }),
      ClearedCopy: ({ revision }) => ({
        model: revision !== model.revision ? model : { ...model, copied: false },
      }),
    },
  );

export const view = Submodel.defineView<Model, Message>((model, h) => {
  if (model.sourceUrl === undefined) return h.empty;
  const options = { locale: model.locale };
  return h.nav(
    [h.Class("article-actions"), h.Attribute("aria-label", m.site_page_actions({}, options))],
    [
      h.button(
        [
          h.Id("site-copy-markdown"),
          h.Class("site-action"),
          h.Type("button"),
          h.OnClick(Message.ClickedCopy()),
        ],
        [model.copied ? m.install_copied_label({}, options) : m.site_copy_markdown({}, options)],
      ),
      h.a(
        [
          h.Id("site-view-markdown"),
          h.Class("site-action"),
          h.Href(localizedSitePath(model.path, model.locale) + ".md"),
        ],
        [m.site_view_markdown({}, options)],
      ),
      h.a(
        [h.Id("site-view-source"), h.Class("site-action"), h.Href(model.sourceUrl)],
        [m.site_view_source({}, options)],
      ),
      model.failed
        ? h.p([h.Attribute("role", "alert")], [m.site_copy_error({}, options)])
        : h.empty,
    ],
  );
});
