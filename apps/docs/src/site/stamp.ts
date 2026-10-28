import { Effect, Match, Option, Redacted, Schema, Stream } from "effect";
import * as Mount from "foldkit/mount";
import * as Subscription from "foldkit/subscription";
import { SigningImages } from "./signing-images.ts";
import { PdfErrorCodeSchema, PdfErrorCodeValue, pdfErrorMessages } from "@signature-kit/pdf/config";
import { errorMessage } from "@signature-kit/i18n";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";
import type { A1CertificateProfile } from "@signature-kit/a1/config";
import type { PdfSignatureBadge } from "@signature-kit/pdf/config";

import { SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";

export const Model = Schema.Struct({
  locale: SiteLocale,
  title: Schema.String,
  color: Schema.String,
  includeIdentity: Schema.Boolean,
  includeDate: Schema.Boolean,
  rubricEveryPage: Schema.Boolean,
  logoId: Schema.optional(Schema.NonEmptyString),
  logoIssue: Schema.optional(PdfErrorCodeSchema),
  logoPreview: Schema.Literals(["idle", "loading", "mounted", "ready", "failed"]),
});
export type Model = typeof Model.Type;

const ViewInputs = Schema.Struct({ disabled: Schema.Boolean });

export const Message = defineMessageUnion({
  ChangedTitle: { value: Schema.String },
  ChangedColor: { value: Schema.String },
  ToggledIdentity: {},
  ToggledDate: {},
  ToggledRubric: {},
  PickedLogo: {},
  ClickedRemoveLogo: {},
  LoadedLogo: { id: Schema.NonEmptyString },
  RejectedLogo: { code: PdfErrorCodeSchema },
  RemovedLogo: {},
  MountedLogo: { id: Schema.NonEmptyString },
  LostLogo: { id: Schema.NonEmptyString },
  LogoPreviewLoaded: { id: Schema.NonEmptyString },
  LogoPreviewFailed: { id: Schema.NonEmptyString },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({ PickedLogo: {}, RemovedLogo: {} });
export type OutMessage = typeof OutMessage.Type;

const MountLogo = Mount.define("MountSigningLogo", {
  args: { id: Schema.NonEmptyString },
  messages: [Message.MountedLogo],
  execute: ({ id }) => Effect.succeed(Message.MountedLogo({ id })),
});

export const subscriptions = Subscription.make<Model, Message, SigningImages>()((entry) => ({
  logoPreview: entry(
    { logoId: Schema.OptionFromNullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({
        logoId:
          model.logoId !== undefined && model.logoPreview !== "loading"
            ? Option.some(model.logoId)
            : Option.none(),
      }),
      dependenciesToStream: ({ logoId }) =>
        Option.match(logoId, {
          onNone: () => Stream.empty,
          onSome: (id) =>
            Stream.unwrap(
              Effect.gen(function* () {
                const images = yield* SigningImages;
                const logo = yield* images.logo;
                if (Option.isNone(logo) || logo.value.id !== id)
                  return Stream.make(Message.LostLogo({ id }));
                const element = document.getElementById("stamp-logo-preview");
                if (element === null) return Stream.empty;
                const url = yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    URL.createObjectURL(
                      new Blob([new Uint8Array(Redacted.value(logo.value.bytes))], {
                        type: "image/png",
                      }),
                    ),
                  ),
                  (url) =>
                    Effect.sync(() => {
                      element.removeAttribute("src");
                      URL.revokeObjectURL(url);
                    }),
                );
                yield* Effect.sync(() => element.setAttribute("src", url));
                return Stream.never;
              }),
            ),
        }),
    },
  ),
}));

export const init = (locale: typeof SiteLocale.Type): Model => ({
  locale,
  title: "",
  color: "#3B5BDB",
  includeIdentity: true,
  includeDate: true,
  rubricEveryPage: false,
  logoPreview: "idle",
});

export const update = (
  model: Model,
  message: Message,
): Update.ReturnWithOutMessage<Model, Message, OutMessage> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    PickedLogo: () => ({ model, outMessage: OutMessage.PickedLogo() }),
    ClickedRemoveLogo: () => ({ model, outMessage: OutMessage.RemovedLogo() }),
    LoadedLogo: ({ id }) => ({
      model: { ...model, logoId: id, logoIssue: undefined, logoPreview: "loading" },
    }),
    RejectedLogo: ({ code }) => ({ model: { ...model, logoIssue: code } }),
    RemovedLogo: () => ({
      model: { ...model, logoId: undefined, logoIssue: undefined, logoPreview: "idle" },
    }),
    MountedLogo: ({ id }) => ({
      model: model.logoId === id ? { ...model, logoPreview: "mounted" } : model,
    }),
    LostLogo: ({ id }) => ({
      model: model.logoId === id ? { ...model, logoId: undefined, logoPreview: "idle" } : model,
    }),
    LogoPreviewLoaded: ({ id }) => ({
      model: model.logoId === id ? { ...model, logoPreview: "ready" } : model,
    }),
    LogoPreviewFailed: ({ id }) => ({
      model: model.logoId === id ? { ...model, logoPreview: "failed" } : model,
    }),
    ChangedTitle: ({ value }) => ({ model: { ...model, title: value } }),
    ChangedColor: ({ value }) => ({ model: { ...model, color: value } }),
    ToggledIdentity: () => ({ model: { ...model, includeIdentity: !model.includeIdentity } }),
    ToggledDate: () => ({ model: { ...model, includeDate: !model.includeDate } }),
    ToggledRubric: () => ({ model: { ...model, rubricEveryPage: !model.rubricEveryPage } }),
  });

export const signatureBadge = (
  model: Model,
  profile: A1CertificateProfile,
  signingTime: Date,
): PdfSignatureBadge => {
  const options = { locale: model.locale };
  const date = [
    {
      label: m.signer_stamp_date_label({}, options),
      value: new Intl.DateTimeFormat(model.locale, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(signingTime),
    },
  ];
  const documentLabel = Match.value(profile.document.replace(/\D/gu, "").length).pipe(
    Match.when(11, () => m.signer_stamp_cpf_label({}, options)),
    Match.when(14, () => m.signer_stamp_cnpj_label({}, options)),
    Match.orElse(() => m.signer_preview_document({}, options)),
  );
  const identity = [
    [{ label: m.signer_stamp_signer_label({}, options), value: profile.subject }],
    [
      {
        label: m.signer_stamp_company_label({}, options),
        value: profile.organization ?? profile.subject,
      },
    ],
    [{ label: documentLabel, value: profile.document }, ...(model.includeDate ? date : [])],
    [
      {
        label: m.signer_stamp_certificate_label({}, options),
        value: m.signer_stamp_certificate_value({}, options),
      },
    ],
  ];
  return {
    header: { text: model.title.trim() || m.signer_stamp_title({}, options) },
    rows: model.includeIdentity ? identity : model.includeDate ? [date] : [],
    footer: [
      { text: m.signer_stamp_footer_mp({}, options) },
      { text: m.signer_stamp_footer_law_14063({}, options) },
      { text: m.signer_stamp_footer_iti_ordinance({}, options) },
      { text: "validar.iti.gov.br", link: "https://validar.iti.gov.br" },
      { text: "SignatureKit" },
    ],
    qr: { text: "https://validar.iti.gov.br" },
    theme: { headerColor: model.color, borderColor: model.color },
  };
};

export const view = Submodel.defineView<Model, Message, typeof ViewInputs.Type>(
  (model, inputs, h) => {
    const options = { locale: model.locale };
    return h.fieldset(
      [h.Disabled(inputs.disabled), h.Class("stamp-settings")],
      [
        h.legend([], [m.signer_step_stamp({}, options)]),
        h.label([h.Attribute("for", "stamp-title")], [m.signer_stamp_custom_title({}, options)]),
        h.input([
          h.Id("stamp-title"),
          h.Type("text"),
          h.Value(model.title),
          h.Placeholder(m.signer_stamp_title({}, options)),
          h.Attribute("maxlength", "100"),
          h.OnInput((value) => Message.ChangedTitle({ value })),
        ]),
        h.label([h.Attribute("for", "stamp-color")], [m.signer_stamp_color({}, options)]),
        h.input([
          h.Id("stamp-color"),
          h.Type("color"),
          h.Value(model.color),
          h.OnInput((value) => Message.ChangedColor({ value })),
        ]),
        h.label([h.Attribute("for", "stamp-logo")], [m.signer_stamp_logo({}, options)]),
        h.input([
          h.Id("stamp-logo"),
          h.Type("file"),
          h.Accept("image/png"),
          h.OnChange(() => Message.PickedLogo()),
        ]),
        model.logoIssue === undefined
          ? h.empty
          : h.p(
              [h.Id("stamp-logo-error"), h.Attribute("role", "alert")],
              [
                errorMessage(
                  { _tag: "PdfError", code: model.logoIssue },
                  {
                    locale: model.locale,
                    catalogs: [pdfErrorMessages],
                    overrides: {
                      "en-US": {
                        [PdfErrorCodeValue.stampFailed]: m.signer_stamp_logo_invalid(
                          {},
                          { locale: "en-US" },
                        ),
                        [PdfErrorCodeValue.fileReadFailed]: m.signer_stamp_logo_invalid(
                          {},
                          { locale: "en-US" },
                        ),
                      },
                      "pt-BR": {
                        [PdfErrorCodeValue.stampFailed]: m.signer_stamp_logo_invalid(
                          {},
                          { locale: "pt-BR" },
                        ),
                        [PdfErrorCodeValue.fileReadFailed]: m.signer_stamp_logo_invalid(
                          {},
                          { locale: "pt-BR" },
                        ),
                      },
                    },
                  },
                ),
              ],
            ),
        model.logoId === undefined
          ? h.empty
          : h.img([
              h.Key(model.logoId),
              h.Id("stamp-logo-preview"),
              h.Alt(m.signer_stamp_logo({}, options)),
              h.Style({ maxWidth: "10rem", maxHeight: "4rem" }),
              h.DataAttribute("state", model.logoPreview),
              h.OnMount(MountLogo({ id: model.logoId })),
              h.OnLoad(Message.LogoPreviewLoaded({ id: model.logoId })),
              h.OnError(Message.LogoPreviewFailed({ id: model.logoId })),
            ]),
        model.logoPreview === "failed"
          ? h.p([h.Attribute("role", "alert")], [m.signer_stamp_preview_failed({}, options)])
          : h.empty,
        model.logoId === undefined
          ? h.empty
          : h.button(
              [h.Id("stamp-logo-remove"), h.Type("button"), h.OnClick(Message.ClickedRemoveLogo())],
              [m.signer_stamp_logo_remove({}, options)],
            ),
        h.label(
          [h.Attribute("for", "stamp-name")],
          [
            h.input([
              h.Id("stamp-name"),
              h.Type("checkbox"),
              h.Checked(model.includeIdentity),
              h.OnClick(Message.ToggledIdentity()),
            ]),
            m.signer_chk_name({}, options),
          ],
        ),
        h.label(
          [h.Attribute("for", "stamp-date")],
          [
            h.input([
              h.Id("stamp-date"),
              h.Type("checkbox"),
              h.Checked(model.includeDate),
              h.OnClick(Message.ToggledDate()),
            ]),
            m.signer_chk_date({}, options),
          ],
        ),
        h.label(
          [h.Attribute("for", "signing-rubric")],
          [
            h.input([
              h.Id("signing-rubric"),
              h.Type("checkbox"),
              h.Checked(model.rubricEveryPage),
              h.OnClick(Message.ToggledRubric()),
            ]),
            m.signer_chk_rubric({}, options),
          ],
        ),
        h.p([], [m.signer_rubric_note_initials({}, options)]),
      ],
    );
  },
);
