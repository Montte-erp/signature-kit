import * as AutoDemo from "./auto-demo.ts";
import { Array as EffectArray, Duration, Effect, Match, Option, Schema } from "effect";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Command from "foldkit/command";
import * as Signer from "./signer.ts";
import type { PdfPreview } from "./pdf-preview.ts";
import type { SigningImages } from "./signing-images.ts";
import type { SigningSession } from "./signing-session.ts";
import type { SigningIdentity } from "./signing-identity.ts";
import * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";
import * as Subscription from "foldkit/subscription";

import { localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { firstCallExample, providerExamples } from "../../lib/signing-examples.ts";
import { m } from "../../paraglide/messages.js";
import type { ContentEntry } from "../content/config.ts";

const ProviderFilename = Schema.Literals(providerExamples.map((provider) => provider.filename));
const PackageManager = Schema.Literals(["bun", "npm", "pnpm", "yarn"]);
const CopyTarget = Schema.Literals(["hero", "install", "provider", "example"]);

export const Model = Schema.Struct({
  locale: SiteLocale,
  signer: Signer.Model,
  autoDemo: AutoDemo.Model,
  provider: ProviderFilename,
  manager: PackageManager,
  copyRevision: Schema.Int,
  copied: Schema.optional(CopyTarget),
  copyFailed: Schema.optional(CopyTarget),
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  GotSignerMessage: { message: Signer.Message },
  GotAutoDemoMessage: { message: AutoDemo.Message },
  SelectedProvider: { filename: ProviderFilename },
  SelectedManager: { manager: PackageManager },
  ClickedCopy: { target: CopyTarget, text: Schema.String },
  CopiedText: { target: CopyTarget, revision: Schema.Int },
  RejectedCopy: { target: CopyTarget, revision: Schema.Int },
  ClearedCopy: { revision: Schema.Int },
});
export type Message = typeof Message.Type;

const CopyText = Command.define("CopyLandingText", {
  args: { target: CopyTarget, text: Schema.String, revision: Schema.Int },
  messages: [Message.CopiedText, Message.RejectedCopy],
  execute: Effect.fn(function* ({ target, text, revision }) {
    const clipboard = yield* Clipboard.Clipboard;
    return yield* clipboard.writeString(text).pipe(
      Effect.match({
        onSuccess: () => Message.CopiedText({ target, revision }),
        onFailure: () => Message.RejectedCopy({ target, revision }),
      }),
    );
  }),
});

const ClearCopy = Command.define("ClearLandingCopyFeedback", {
  args: { revision: Schema.Int },
  messages: [Message.ClearedCopy],
  execute: ({ revision }) =>
    Effect.sleep(Duration.millis(1800)).pipe(Effect.as(Message.ClearedCopy({ revision }))),
});

export const init = (
  locale: typeof SiteLocale.Type,
  presentation: Signer.Presentation = "dialog",
): Model => ({
  locale,
  signer: Signer.init(locale, presentation),
  autoDemo: AutoDemo.init(locale),
  provider: "clicksign.ts",
  manager: "bun",
  copyRevision: 0,
});

const foldSigner = Update.foldChild({
  update: Signer.update,
  read: (model: Model) => Option.some(model.signer),
  write: (model, signer) => ({ ...model, signer }),
  toParentMessage: (message) => Message.GotSignerMessage({ message }),
});

const foldAutoDemo = Update.foldChild({
  update: AutoDemo.update,
  read: (model: Model) => Option.some(model.autoDemo),
  write: (model, autoDemo) => ({ ...model, autoDemo }),
  toParentMessage: (message) => Message.GotAutoDemoMessage({ message }),
});

export const update = (
  model: Model,
  message: Message,
): Update.Return<
  Model,
  Message,
  SigningSession | PdfPreview | SigningImages | SigningIdentity | Clipboard.Clipboard
> =>
  Message.match<
    Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity | Clipboard.Clipboard
    >
  >(message, {
    GotSignerMessage: ({ message }) => foldSigner(model, message),
    GotAutoDemoMessage: ({ message }) => foldAutoDemo(model, message),
    SelectedProvider: ({ filename }) => ({
      model: {
        ...model,
        provider: filename,
        copied: undefined,
        copyFailed: undefined,
        copyRevision: model.copyRevision + 1,
      },
    }),
    SelectedManager: ({ manager }) => ({
      model: {
        ...model,
        manager,
        copied: undefined,
        copyFailed: undefined,
        copyRevision: model.copyRevision + 1,
      },
    }),
    ClickedCopy: ({ target, text }) => {
      const revision = model.copyRevision + 1;
      return {
        model: { ...model, copyRevision: revision, copied: undefined, copyFailed: undefined },
        commands: [CopyText({ target, text, revision })],
      };
    },
    CopiedText: ({ target, revision }) =>
      revision !== model.copyRevision
        ? { model }
        : {
            model: { ...model, copied: target, copyFailed: undefined },
            commands: [ClearCopy({ revision })],
          },
    RejectedCopy: ({ target, revision }) =>
      revision !== model.copyRevision
        ? { model }
        : { model: { ...model, copied: undefined, copyFailed: target } },
    ClearedCopy: ({ revision }) => ({
      model: revision === model.copyRevision ? { ...model, copied: undefined } : model,
    }),
  });

export const homeEntry = (locale: typeof SiteLocale.Type): ContentEntry => ({
  locale,
  path: "",
  page: {
    title: m.hero_title({}, { locale }),
    description: m.hero_subhead({}, { locale }),
    html: "",
    text: m.hero_subhead({}, { locale }),
    headings: [],
  },
});

export const subscriptions = Subscription.aggregate(
  Subscription.lift(Signer.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.signer),
    toParentMessage: (message) => Message.GotSignerMessage({ message }),
  }),
  Subscription.lift(AutoDemo.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.autoDemo),
    toParentMessage: (message) => Message.GotAutoDemoMessage({ message }),
  }),
);

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  const install =
    Match.value(model.manager).pipe(
      Match.when("bun", () => "bun add"),
      Match.when("npm", () => "npm install"),
      Match.when("pnpm", () => "pnpm add"),
      Match.when("yarn", () => "yarn add"),
      Match.exhaustive,
    ) + " @signature-kit/signatures @signature-kit/a1";
  const capabilities = [
    {
      title: m.cap1_title({}, options),
      description: m.cap1_desc({}, options),
      path: "docs/signing/signers",
    },
    {
      title: m.cap2_title({}, options),
      description: m.cap2_desc({}, options),
      path: "docs/get-started/quickstart",
    },
    {
      title: m.cap3_title({}, options),
      description: m.cap3_desc({}, options),
      path: "docs/signing/pdf",
    },
    {
      title: m.cap4_title({}, options),
      description: m.cap4_desc({}, options),
      path: "docs/signing/xml",
    },
    {
      title: m.cap5_title({}, options),
      description: m.cap5_desc({}, options),
      path: "docs/providers/request-shape",
    },
    {
      title: m.cap6_title({}, options),
      description: m.cap6_desc({}, options),
      path: "docs/signing/errors",
    },
    {
      title: m.cap7_title({}, options),
      description: m.cap7_desc({}, options),
      path: "docs/a1-signing/browser-pdf-flow",
    },
  ];
  return h.div(
    [h.Class("landing")],
    [
      model.copyFailed === undefined
        ? h.empty
        : h.p([h.Attribute("role", "alert")], [m.site_copy_error({}, options)]),
      h.section(
        [h.Class("landing-hero")],
        [
          h.a(
            [h.Href("https://github.com/Montte-erp/signature-kit"), h.Class("landing-badge")],
            [m.hero_badge({}, options)],
          ),
          h.h1([], [m.hero_title({}, options)]),
          h.p([], [m.hero_subhead({}, options)]),
          h.pre([], [h.code([], [install])]),
          h.button(
            [
              h.Type("button"),
              h.Id("home-copy-hero"),
              h.OnClick(Message.ClickedCopy({ target: "hero", text: install })),
            ],
            [
              model.copied === "hero"
                ? m.install_copied_label({}, options)
                : m.install_copy_label({}, options),
            ],
          ),
          h.a(
            [h.Href(localizedSitePath("docs", model.locale)), h.Class("site-action")],
            [m.hero_cta_docs({}, options)],
          ),
        ],
      ),
      h.submodel({
        slotId: "home-signer",
        model: model.signer,
        view: Signer.view,
        toParentMessage: (message) => Message.GotSignerMessage({ message }),
      }),
      h.submodel({
        slotId: "home-auto",
        model: model.autoDemo,
        view: AutoDemo.view,
        toParentMessage: (message) => Message.GotAutoDemoMessage({ message }),
      }),
      h.nav(
        [
          h.Class("landing-integrations"),
          h.Attribute("aria-label", m.showcase_eyebrow({}, options)),
        ],
        providerExamples.map((provider) =>
          h.a(
            [
              h.Href(
                localizedSitePath(`docs/providers/${provider.filename.slice(0, -3)}`, model.locale),
              ),
            ],
            [provider.name],
          ),
        ),
      ),
      h.section(
        [h.Class("landing-section"), h.Id("home-providers")],
        [
          h.p([h.Class("eyebrow")], [m.showcase_eyebrow({}, options)]),
          h.h2([], [m.showcase_title({}, options)]),
          h.p([], [m.showcase_lead({}, options)]),
          h.div(
            [
              h.Attribute("role", "tablist"),
              h.Attribute("aria-label", m.showcase_card_provider({}, options)),
            ],
            providerExamples.map((provider, index) =>
              h.button(
                [
                  h.Type("button"),
                  h.Id(`home-provider-${provider.filename.slice(0, -3)}`),
                  h.Attribute("role", "tab"),
                  h.Attribute("aria-selected", String(model.provider === provider.filename)),
                  h.Attribute("aria-controls", `home-example-${provider.filename}`),
                  h.Tabindex(model.provider === provider.filename ? 0 : -1),
                  h.OnKeyDownFocus((key, modifiers) => {
                    if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey)
                      return Option.none();
                    return Match.value(key).pipe(
                      Match.when("ArrowRight", () =>
                        EffectArray.get(providerExamples, (index + 1) % providerExamples.length),
                      ),
                      Match.when("ArrowLeft", () =>
                        EffectArray.get(
                          providerExamples,
                          (index + providerExamples.length - 1) % providerExamples.length,
                        ),
                      ),
                      Match.when("Home", () => EffectArray.head(providerExamples)),
                      Match.when("End", () => EffectArray.last(providerExamples)),
                      Match.orElse(() => Option.none()),
                      Option.map((next) => ({
                        focusSelector: `#home-provider-${next.filename.slice(0, -3)}`,
                        message: Message.SelectedProvider({ filename: next.filename }),
                      })),
                    );
                  }),
                  h.OnClick(Message.SelectedProvider({ filename: provider.filename })),
                ],
                [provider.name],
              ),
            ),
          ),
          ...providerExamples.map((provider) =>
            h.div(
              [
                h.Id(`home-example-${provider.filename}`),
                h.Attribute("role", "tabpanel"),
                h.Attribute("aria-labelledby", `home-provider-${provider.filename.slice(0, -3)}`),
                h.Hidden(model.provider !== provider.filename),
              ],
              [
                h.p([], [provider.filename]),
                h.pre([], [h.code([], [provider.code])]),
                h.button(
                  [
                    h.Type("button"),
                    h.Id(
                      model.provider === provider.filename
                        ? "home-copy-provider"
                        : `home-copy-provider-${provider.filename}`,
                    ),
                    h.OnClick(Message.ClickedCopy({ target: "provider", text: provider.code })),
                  ],
                  [
                    model.copied === "provider"
                      ? m.showcase_copied({}, options)
                      : m.showcase_copy({}, options),
                  ],
                ),
              ],
            ),
          ),
          h.a(
            [h.Href(localizedSitePath("docs/providers/request-shape", model.locale))],
            [m.showcase_cta_browse({}, options)],
          ),
        ],
      ),
      h.section(
        [h.Class("landing-section")],
        [
          h.p([h.Class("eyebrow")], [m.cap_eyebrow({}, options)]),
          h.h2([], [m.cap_title({}, options)]),
          h.p([], [m.cap_lead({}, options)]),
          h.div(
            [h.Class("landing-capabilities")],
            capabilities.map((capability) =>
              h.article(
                [],
                [
                  h.h3([], [capability.title]),
                  h.p([], [capability.description]),
                  h.a(
                    [h.Href(localizedSitePath(capability.path, model.locale))],
                    [m.cap_read_docs({}, options)],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      h.section(
        [h.Class("landing-section"), h.Id("home-get-started")],
        [
          h.p([h.Class("eyebrow")], [m.gs_eyebrow({}, options)]),
          h.h2([], [m.gs_title({}, options)]),
          h.p([], [m.gs_lead({}, options)]),
          h.h3([], [m.gs_step1_heading({}, options)]),
          h.div(
            [
              h.Attribute("role", "group"),
              h.Attribute("aria-label", m.gs_step1_heading({}, options)),
            ],
            PackageManager.literals.map((manager) =>
              h.button(
                [
                  h.Type("button"),
                  h.Id(`home-install-${manager}`),
                  h.Attribute("aria-pressed", String(model.manager === manager)),
                  h.OnClick(Message.SelectedManager({ manager })),
                ],
                [manager],
              ),
            ),
          ),
          h.pre([h.Id("home-install-command")], [h.code([], [install])]),
          h.button(
            [
              h.Type("button"),
              h.Id("home-copy-install"),
              h.OnClick(Message.ClickedCopy({ target: "install", text: install })),
            ],
            [
              model.copied === "install"
                ? m.install_copied_label({}, options)
                : m.install_copy_label({}, options),
            ],
          ),
          h.h3([], [m.gs_step2_heading({}, options)]),
          h.pre([], [h.code([], [firstCallExample])]),
          h.button(
            [
              h.Type("button"),
              h.Id("home-copy-example"),
              h.OnClick(Message.ClickedCopy({ target: "example", text: firstCallExample })),
            ],
            [
              model.copied === "example"
                ? m.showcase_copied({}, options)
                : m.showcase_copy({}, options),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class("landing-sponsors")],
        [
          h.p([h.Class("eyebrow")], [m.sponsors_eyebrow({}, options)]),
          h.a([h.Href("https://licitei.com.br")], ["Licitei"]),
        ],
      ),
      h.section(
        [h.Class("landing-section landing-final")],
        [
          h.p([h.Class("eyebrow")], [m.final_eyebrow({}, options)]),
          h.h2([], [m.final_title({}, options)]),
          h.p([], [m.final_lead({}, options)]),
          h.a(
            [
              h.Href(localizedSitePath("docs/get-started/quickstart", model.locale)),
              h.Class("site-action"),
            ],
            [m.final_cta({}, options)],
          ),
        ],
      ),
    ],
  );
});
