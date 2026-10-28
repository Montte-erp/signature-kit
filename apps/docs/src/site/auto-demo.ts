import { Effect, Option, Schema, Stream } from "effect";
import * as Command from "foldkit/command";
import * as Mount from "foldkit/mount";
import * as Submodel from "foldkit/submodel";
import * as Subscription from "foldkit/subscription";
import type * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";
import { SiteLocale } from "../../lib/site-route.ts";
import { SignatureVariant } from "../../lib/formal-contract.ts";
import { demoParagraphs } from "../../lib/demo-contracts.ts";
import { m } from "../../paraglide/messages.js";
import { AutoDocuments, AutoPreview } from "./auto-documents.ts";

const ExampleId = Schema.Literals(["contract", "amendment", "power-of-attorney", "terms"]);
const Example = Schema.Struct({
  id: ExampleId,
  state: Schema.Literals(["queued", "ready", "stamping", "stamped", "failed"]),
});
export const Model = Schema.Struct({
  locale: SiteLocale,
  active: Schema.Boolean,
  running: Schema.Boolean,
  busy: Schema.Boolean,
  revision: Schema.Int,
  failed: Schema.Boolean,
  documents: Schema.Array(Example),
  selected: ExampleId,
  mounted: Schema.Boolean,
  preview: Schema.Literals(["loading", "ready", "failed"]),
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  BecameVisible: {},
  ClickedRun: {},
  StartedStamp: { id: ExampleId, revision: Schema.Int },
  StampedDocument: { id: ExampleId, revision: Schema.Int },
  FailedStamp: { id: ExampleId, revision: Schema.Int },
  FinishedRun: { revision: Schema.Int },
  ClickedReset: {},
  ResetDocuments: {},
  ClickedDownload: {},
  DownloadedDocument: {},
  FailedDownload: {},
  PreparedDocument: { id: ExampleId },
  SelectedDocument: { id: ExampleId },
  MountedPreview: {},
  RenderedPreview: { id: ExampleId, revision: Schema.Int },
  FailedPreview: { id: ExampleId, revision: Schema.Int },
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

const ResetDocuments = Command.define("ResetAutomaticDocuments", {
  messages: [Message.ResetDocuments],
  execute: Effect.gen(function* () {
    const documents = yield* AutoDocuments;
    const preview = yield* AutoPreview;
    yield* documents.reset;
    yield* preview.clear;
    return Message.ResetDocuments();
  }),
});
const DownloadDocument = Command.define("DownloadAutomaticDocument", {
  args: { id: ExampleId, locale: SiteLocale },
  messages: [Message.DownloadedDocument, Message.FailedDownload],
  execute: ({ id, locale }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const documents = yield* AutoDocuments;
        const bytes = yield* documents.sourceDocument(id);
        const url = yield* Effect.acquireRelease(
          Effect.sync(() =>
            URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })),
          ),
          (url) => Effect.sync(() => URL.revokeObjectURL(url)),
        );
        yield* Effect.sync(() => {
          const link = document.createElement("a");
          link.href = url;
          link.download = names[id]({}, { locale }) + ".pdf";
          document.body.append(link);
          link.click();
          link.remove();
        });
        yield* Effect.yieldNow;
        return Message.DownloadedDocument();
      }),
    ).pipe(Effect.catchTag("PdfError", () => Effect.succeed(Message.FailedDownload()))),
});

export const init = (locale: typeof SiteLocale.Type): Model => ({
  locale,
  active: false,
  running: false,
  busy: false,
  revision: 0,
  failed: false,
  documents: ExampleId.literals.map((id) => ({ id, state: "queued" })),
  selected: "contract",
  mounted: false,
  preview: "loading",
});
export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, AutoDocuments | AutoPreview> =>
  Message.match<Update.Return<Model, Message, AutoDocuments | AutoPreview>>(message, {
    BecameVisible: () => ({ model: { ...model, active: true } }),
    ClickedRun: () => ({
      model:
        model.busy || model.documents.some((row) => row.state !== "ready")
          ? model
          : { ...model, running: true, busy: true, failed: false, revision: model.revision + 1 },
    }),
    StartedStamp: ({ id, revision }) => ({
      model:
        revision !== model.revision || !model.running
          ? model
          : {
              ...model,
              selected: id,
              preview: "loading",
              documents: model.documents.map((row) =>
                row.id === id ? { ...row, state: "stamping" } : row,
              ),
            },
    }),
    StampedDocument: ({ id, revision }) => ({
      model:
        revision !== model.revision || !model.running
          ? model
          : {
              ...model,
              documents: model.documents.map((row) =>
                row.id === id ? { ...row, state: "stamped" } : row,
              ),
            },
    }),
    FailedStamp: ({ id, revision }) => ({
      model:
        revision !== model.revision || !model.running
          ? model
          : {
              ...model,
              failed: true,
              documents: model.documents.map((row) =>
                row.id === id ? { ...row, state: "failed" } : row,
              ),
            },
    }),
    FinishedRun: ({ revision }) => ({
      model: revision !== model.revision ? model : { ...model, running: false, busy: false },
    }),
    ClickedReset: () =>
      model.busy
        ? { model }
        : {
            model: {
              ...model,
              busy: true,
              failed: false,
              revision: model.revision + 1,
              preview: "loading",
            },
            commands: [ResetDocuments()],
          },
    ResetDocuments: () => ({
      model: {
        ...model,
        busy: false,
        selected: "contract",
        preview: "loading",
        documents: model.documents.map((row) => ({ ...row, state: "ready" })),
      },
    }),
    ClickedDownload: () =>
      model.busy ||
      !model.documents.some(
        (row) => row.id === model.selected && (row.state === "ready" || row.state === "stamped"),
      )
        ? { model }
        : {
            model: { ...model, busy: true },
            commands: [DownloadDocument({ id: model.selected, locale: model.locale })],
          },
    DownloadedDocument: () => ({ model: { ...model, busy: false } }),
    FailedDownload: () => ({ model: { ...model, busy: false, failed: true } }),
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
    RenderedPreview: ({ id, revision }) => ({
      model:
        model.selected === id && model.revision === revision
          ? { ...model, preview: "ready" }
          : model,
    }),
    FailedPreview: ({ id, revision }) => ({
      model:
        model.selected === id && model.revision === revision
          ? { ...model, preview: "failed" }
          : model,
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
    queue: entry(
      { run: Schema.OptionFromNullOr(Schema.Int), locale: SiteLocale },
      {
        modelToDependencies: (model) => ({
          run: model.running ? Option.some(model.revision) : Option.none(),
          locale: model.locale,
        }),
        dependenciesToStream: ({ run, locale }) =>
          Option.match(run, {
            onNone: () => Stream.empty,
            onSome: (revision) =>
              Stream.fromIterable(ExampleId.literals).pipe(
                Stream.flatMap((id) =>
                  Stream.make(Message.StartedStamp({ id, revision })).pipe(
                    Stream.concat(
                      Stream.fromEffect(
                        Effect.gen(function* () {
                          const documents = yield* AutoDocuments;
                          yield* documents.stamp(id, [
                            "Maria A. Costa",
                            locale === "pt-BR" ? "CMS ilustrativo" : "Illustrative CMS",
                          ]);
                        }).pipe(
                          Effect.match({
                            onSuccess: () => Message.StampedDocument({ id, revision }),
                            onFailure: () => Message.FailedStamp({ id, revision }),
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
                Stream.concat(Stream.make(Message.FinishedRun({ revision }))),
              ),
          }),
      },
    ),
    preview: entry(
      { id: Schema.OptionFromNullOr(ExampleId), revision: Schema.Int },
      {
        modelToDependencies: (model) => ({
          revision: model.revision,
          id:
            model.mounted &&
            !model.busy &&
            model.documents.some(
              (row) =>
                row.id === model.selected && (row.state === "ready" || row.state === "stamped"),
            )
              ? Option.some(model.selected)
              : Option.none(),
        }),
        dependenciesToStream: ({ id, revision }) =>
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
                    yield* preview.remove(id);
                    yield* preview.render(id, 0, canvas);
                  }),
                ).pipe(
                  Effect.match({
                    onSuccess: () => Message.RenderedPreview({ id, revision }),
                    onFailure: () => Message.FailedPreview({ id, revision }),
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
    [
      h.Id("home-auto-demo"),
      h.Class("landing-section"),
      h.Attribute(
        "aria-busy",
        String(model.busy || model.documents.some((row) => row.state === "queued")),
      ),
      h.Attribute("data-active", String(model.active)),
      h.OnMount(Visible()),
    ],
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
              row.state === "stamped"
                ? m.autosign_doc_signed({}, options)
                : row.state === "stamping"
                  ? m.autosign_doc_signing({}, options)
                  : row.state === "ready"
                    ? m.autosign_doc_ready({}, options)
                    : row.state === "failed"
                      ? m.signer_error_generic({}, options)
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
          h.Disabled(model.busy || model.documents.some((row) => row.state !== "ready")),
          h.OnClick(Message.ClickedRun()),
        ],
        [m.autosign_cta({}, options)],
      ),
      h.button(
        [
          h.Id("home-auto-download"),
          h.Type("button"),
          h.Disabled(model.busy || model.documents.some((row) => row.state === "queued")),
          h.OnClick(Message.ClickedDownload()),
        ],
        [m.autosign_download({}, options)],
      ),
      h.button(
        [
          h.Id("home-auto-reset"),
          h.Type("button"),
          h.Disabled(model.busy || model.documents.some((row) => row.state === "queued")),
          h.OnClick(Message.ClickedReset()),
        ],
        [m.autosign_reset({}, options)],
      ),
      model.failed
        ? h.p([h.Attribute("role", "alert")], [m.signer_error_signing_failed({}, options)])
        : h.empty,
      h.p([], [m.autosign_note({}, options)]),
    ],
  );
});
