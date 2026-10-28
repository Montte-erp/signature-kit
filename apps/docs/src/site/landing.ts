import { Array as EffectArray, Match, Option, Schema } from "effect";
import * as Signer from "./signer.ts";
import type { PdfPreview } from "./pdf-preview.ts";
import type { SigningSession } from "./signing-session.ts";
import * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";

import { localizedSitePath, SiteLocale } from "../../lib/site-route.ts";
import { firstCallExample, providerExamples } from "../../lib/signing-examples.ts";
import { m } from "../../paraglide/messages.js";
import type { ContentEntry } from "../content/config.ts";

const ProviderFilename = Schema.Literals(providerExamples.map((provider) => provider.filename));
const PackageManager = Schema.Literals(["bun", "npm", "pnpm", "yarn"]);

export const Model = Schema.Struct({
  locale: SiteLocale,
  signer: Signer.Model,
  provider: ProviderFilename,
  manager: PackageManager,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  GotSignerMessage: { message: Signer.Message },
  SelectedProvider: { filename: ProviderFilename },
  SelectedManager: { manager: PackageManager },
});
export type Message = typeof Message.Type;

export const init = (
  locale: typeof SiteLocale.Type,
  presentation: Signer.Presentation = "dialog",
): Model => ({
  locale,
  signer: Signer.init(locale, presentation),
  provider: "clicksign.ts",
  manager: "bun",
});

const foldSigner = Update.foldChild({
  update: Signer.update,
  read: (model: Model) => Option.some(model.signer),
  write: (model, signer) => ({ ...model, signer }),
  toParentMessage: (message) => Message.GotSignerMessage({ message }),
});

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, SigningSession | PdfPreview> =>
  Message.match(message, {
    GotSignerMessage: ({ message }) => foldSigner(model, message),
    SelectedProvider: ({ filename }) => ({ model: { ...model, provider: filename } }),
    SelectedManager: ({ manager }) => ({ model: { ...model, manager } }),
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
              [h.p([], [provider.filename]), h.pre([], [h.code([], [provider.code])])],
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
          h.h3([], [m.gs_step2_heading({}, options)]),
          h.pre([], [h.code([], [firstCallExample])]),
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
