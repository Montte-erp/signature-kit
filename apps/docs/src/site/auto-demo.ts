import { Effect, Option, Schema, Stream } from "effect";
import * as Mount from "foldkit/mount";
import * as Submodel from "foldkit/submodel";
import * as Subscription from "foldkit/subscription";
import * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";
import { SiteLocale } from "../../lib/site-route.ts";
import { SignatureVariant } from "../../lib/formal-contract.ts";
import { demoParagraphs } from "../../lib/demo-contracts.ts";
import { m } from "../../paraglide/messages.js";
import { AutoDocuments, AutoPreview } from "./auto-documents.ts";

const ExampleId = Schema.Literals(["contract", "amendment", "power-of-attorney", "terms"]);
const Example = Schema.Struct({ id: ExampleId, state: Schema.Literals(["queued", "ready"]) });
export const Model = Schema.Struct({
  locale: SiteLocale,
  active: Schema.Boolean,
  documents: Schema.Array(Example),
  selected: ExampleId,
  mounted: Schema.Boolean,
  preview: Schema.Literals(["loading", "ready", "failed"]),
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  BecameVisible: {},
  PreparedDocument: { id: ExampleId },
  SelectedDocument: { id: ExampleId },
  MountedPreview: {},
  RenderedPreview: { id: ExampleId },
  FailedPreview: { id: ExampleId },
});
export type Message = typeof Message.Type;

const Visible = Mount.define("ObserveAutomaticDemo", {
  messages: [Message.BecameVisible],
  execute: ({ element }) =>
    Effect.callback<ReturnType<typeof Message.BecameVisible>>((resume) => {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          resume(Effect.succeed(Message.BecameVisible()));
        }
      });
      observer.observe(element);
      return Effect.sync(() => observer.disconnect());
    }),
});
const Preview = Mount.define("MountAutomaticPreview", {
  messages: [Message.MountedPreview],
  execute: ({ element }) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.succeed(element), (canvas) =>
        Effect.sync(() => {
          canvas.setAttribute("width", "0");
          canvas.setAttribute("height", "0");
        }),
      );
      return Message.MountedPreview();
    }),
});

const names = {
  contract: m.autosign_doc_contract_name,
  amendment: m.autosign_doc_amendment_name,
  "power-of-attorney": m.autosign_doc_poa_name,
  terms: m.autosign_doc_terms_name,
};
const variants = {
  contract: SignatureVariant.literals[0],
  amendment: SignatureVariant.literals[1],
  "power-of-attorney": SignatureVariant.literals[2],
  terms: SignatureVariant.literals[3],
};

export const init = (locale: typeof SiteLocale.Type): Model => ({
  locale,
  active: false,
  documents: ExampleId.literals.map((id) => ({ id, state: "queued" })),
  selected: "contract",
  mounted: false,
  preview: "loading",
});
export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    BecameVisible: () => ({ model: { ...model, active: true } }),
    PreparedDocument: ({ id }) => ({
      model: {
        ...model,
        documents: model.documents.map((row) => (row.id === id ? { ...row, state: "ready" } : row)),
      },
    }),
    SelectedDocument: ({ id }) => ({
      model: model.selected === id ? model : { ...model, selected: id, preview: "loading" },
    }),
    MountedPreview: () => ({ model: { ...model, mounted: true } }),
    RenderedPreview: ({ id }) => ({
      model: model.selected === id ? { ...model, preview: "ready" } : model,
    }),
    FailedPreview: ({ id }) => ({
      model: model.selected === id ? { ...model, preview: "failed" } : model,
    }),
  });

export const subscriptions = Subscription.make<Model, Message, AutoDocuments | AutoPreview>()(
  (entry) => ({
    preparation: entry(
      { active: Schema.Boolean, locale: SiteLocale },
      {
        modelToDependencies: ({ active, locale }) => ({ active, locale }),
        dependenciesToStream: ({ active, locale }) =>
          !active
            ? Stream.empty
            : Stream.fromIterable(ExampleId.literals).pipe(
                Stream.mapEffect((id) =>
                  Effect.gen(function* () {
                    const documents = yield* AutoDocuments;
                    yield* documents.generate(id, {
                      title: names[id]({}, { locale }),
                      paragraphs: demoParagraphs,
                      variant: variants[id],
                    });
                    return Message.PreparedDocument({ id });
                  }),
                ),
              ),
      },
    ),
    preview: entry(
      { id: Schema.OptionFromNullOr(ExampleId) },
      {
        modelToDependencies: (model) => ({
          id:
            model.mounted &&
            model.documents.some((row) => row.id === model.selected && row.state === "ready")
              ? Option.some(model.selected)
              : Option.none(),
        }),
        dependenciesToStream: ({ id }) =>
          Option.match(id, {
            onNone: () => Stream.empty,
            onSome: (id) =>
              Stream.fromEffect(
                Effect.scoped(
                  Effect.gen(function* () {
                    const preview = yield* AutoPreview;
                    const canvas = document.querySelector<HTMLCanvasElement>("#home-auto-preview");
                    if (canvas === null)
                      return yield* Effect.die("The automatic preview canvas must be mounted.");
                    yield* preview.render(id, 0, canvas);
                  }),
                ).pipe(
                  Effect.match({
                    onSuccess: () => Message.RenderedPreview({ id }),
                    onFailure: () => Message.FailedPreview({ id }),
                  }),
                ),
              ),
          }),
      },
    ),
  }),
);

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  return h.section(
    [h.Id("home-auto-demo"), h.Class("landing-section"), h.OnMount(Visible())],
    [
      h.p([h.Class("eyebrow")], [m.autosign_eyebrow({}, options)]),
      h.h2([], [m.autosign_title({}, options)]),
      h.p([], [m.autosign_lead({}, options)]),
      h.div(
        [h.Attribute("role", "tablist"), h.Attribute("aria-label", m.autosign_title({}, options))],
        model.documents.map((row) =>
          h.button(
            [
              h.Type("button"),
              h.Attribute("role", "tab"),
              h.Attribute("aria-selected", String(row.id === model.selected)),
              h.Attribute("data-demo-state", row.state),
              h.OnClick(Message.SelectedDocument({ id: row.id })),
            ],
            [
              names[row.id]({}, options),
              " · ",
              row.state === "ready"
                ? m.autosign_doc_ready({}, options)
                : m.autosign_doc_generating({}, options),
            ],
          ),
        ),
      ),
      h.canvas(
        [
          h.Id("home-auto-preview"),
          h.Attribute("data-state", model.preview),
          h.OnMount(Preview()),
          h.Attribute("style", "width:100%;max-width:595px;height:auto"),
        ],
        [],
      ),
      h.button(
        [
          h.Id("home-auto-run"),
          h.Type("button"),
          h.Disabled(model.documents.some((row) => row.state !== "ready")),
        ],
        [m.autosign_cta({}, options)],
      ),
      h.p([], [m.autosign_note({}, options)]),
    ],
  );
});
