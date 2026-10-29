import { Duration, Effect, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import type { HttpClient } from "effect/http";
import * as Command from "foldkit/command";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";

import { FeedbackApi } from "../feedback/api.ts";
import { PageFeedback } from "../feedback/config.ts";
import { localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";

const FeedbackStatus = Schema.Literals(["idle", "sending", "sent", "failed"]);
export const Model = Schema.Struct({
  locale: SiteLocale,
  path: Schema.String,
  opinion: Schema.optional(PageFeedback.fields.opinion),
  status: FeedbackStatus,
  revision: Schema.Int,
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  SelectedOpinion: { opinion: PageFeedback.fields.opinion },
  ClickedSubmit: {},
  SentFeedback: { revision: Schema.Int },
  RejectedFeedback: { revision: Schema.Int },
});
export type Message = typeof Message.Type;

const SubmitFeedback = Command.define("SubmitPageFeedback", {
  args: {
    route: PageFeedback.fields.route,
    opinion: PageFeedback.fields.opinion,
    revision: Schema.Int,
  },
  messages: [Message.SentFeedback, Message.RejectedFeedback],
  execute: ({ route, opinion, revision }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const comment = document.querySelector<HTMLTextAreaElement>("#site-feedback-message");
        if (comment === null)
          return yield* Effect.die("The feedback form must be mounted before submission");
        const client = yield* HttpApiClient.make(FeedbackApi);
        yield* client.feedback.submitPage({ payload: { route, opinion, message: comment.value } });
        comment.value = "";
      }),
    ).pipe(
      Effect.timeout(Duration.seconds(10)),
      Effect.match({
        onSuccess: () => Message.SentFeedback({ revision }),
        onFailure: () => Message.RejectedFeedback({ revision }),
      }),
    ),
});

export const init = (locale: typeof SiteLocale.Type, path: string): Model => ({
  locale,
  path,
  status: "idle",
  revision: 0,
});
export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, HttpClient.HttpClient> =>
  Message.match<Update.Return<Model, Message, HttpClient.HttpClient>>(message, {
    SelectedOpinion: ({ opinion }) => ({
      model:
        model.status === "sending"
          ? model
          : { ...model, opinion, status: "idle", revision: model.revision + 1 },
    }),
    ClickedSubmit: () => {
      if (model.status === "sending" || model.opinion === undefined) return { model };
      const revision = model.revision + 1;
      return {
        model: { ...model, status: "sending", revision },
        commands: [
          SubmitFeedback({
            route: localizedSitePath(model.path, model.locale),
            opinion: model.opinion,
            revision,
          }),
        ],
      };
    },
    SentFeedback: ({ revision }) => ({
      model: model.revision === revision ? { ...model, status: "sent" } : model,
    }),
    RejectedFeedback: ({ revision }) => ({
      model: model.revision === revision ? { ...model, status: "failed" } : model,
    }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  const busy = model.status === "sending";
  return h.section(
    [
      h.Id("site-feedback"),
      h.Class("page-feedback ph-no-capture"),
      h.DataAttribute("analytics-sensitive", "true"),
      h.DataAttribute("ph-no-capture", "true"),
      h.Attribute("aria-label", m.site_feedback_prompt({}, options)),
    ],
    [
      h.div(
        [h.Class("feedback-opinions")],
        [
          h.p([], [m.site_feedback_prompt({}, options)]),
          h.button(
            [
              h.Id("site-feedback-good"),
              h.Class("site-action"),
              h.Type("button"),
              h.Disabled(busy),
              h.Attribute("aria-pressed", String(model.opinion === "good")),
              h.OnClick(Message.SelectedOpinion({ opinion: "good" })),
            ],
            [m.site_feedback_good({}, options)],
          ),
          h.button(
            [
              h.Id("site-feedback-bad"),
              h.Class("site-action"),
              h.Type("button"),
              h.Disabled(busy),
              h.Attribute("aria-pressed", String(model.opinion === "bad")),
              h.OnClick(Message.SelectedOpinion({ opinion: "bad" })),
            ],
            [m.site_feedback_bad({}, options)],
          ),
        ],
      ),
      model.opinion === undefined
        ? h.empty
        : h.form(
            [
              h.Id("site-feedback-form"),
              h.OnSubmit(Message.ClickedSubmit()),
              h.Attribute("aria-busy", String(busy)),
            ],
            [
              h.label([h.For("site-feedback-message")], [m.site_feedback_message({}, options)]),
              h.textarea([
                h.Id("site-feedback-message"),
                h.Name("comment"),
                h.Rows(4),
                h.Disabled(busy),
              ]),
              h.button(
                [h.Class("site-action"), h.Type("submit"), h.Disabled(busy)],
                [busy ? m.site_feedback_sending({}, options) : m.site_feedback_submit({}, options)],
              ),
            ],
          ),
      model.status === "failed"
        ? h.p([h.Attribute("role", "alert")], [m.site_feedback_failed({}, options)])
        : h.empty,
      model.status === "sent"
        ? h.p([h.Attribute("role", "status")], [m.site_feedback_sent({}, options)])
        : h.empty,
    ],
  );
});
