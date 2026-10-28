import { Match, Schema } from "effect";
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
});
export type Model = typeof Model.Type;

const ViewInputs = Schema.Struct({ disabled: Schema.Boolean });

export const Message = defineMessageUnion({
  ChangedTitle: { value: Schema.String },
  ChangedColor: { value: Schema.String },
  ToggledIdentity: {},
  ToggledDate: {},
  ToggledRubric: {},
});
export type Message = typeof Message.Type;

export const init = (locale: typeof SiteLocale.Type): Model => ({
  locale,
  title: "",
  color: "#3B5BDB",
  includeIdentity: true,
  includeDate: true,
  rubricEveryPage: false,
});

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match(message, {
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
