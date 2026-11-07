import { pageRoute } from "./routes";
import { Button } from "@foldkit/ui";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import * as Mount from "foldkit/mount";
import type { Html, HtmlBuilder } from "foldkit/html";
import en from "../messages/en-US.json";
import pt from "../messages/pt-BR.json";
import { captureDocsEvent } from "../lib/posthog/client";
import type { Locale } from "./content";

export const Theme = Schema.Literals(["light", "dark"]);
export const ThemeLoaded = Schema.TaggedStruct("ThemeLoaded", { theme: Theme });
export const ThemeMount = Mount.define("ThemeMount", {
  messages: [ThemeLoaded],
  execute: ({ element }) =>
    Effect.try({
      try: (): typeof Theme.Type => {
        const theme = localStorage.getItem("signaturekit-theme") === "dark" ? "dark" : "light";
        element.setAttribute("data-theme", theme);
        return theme;
      },
      catch: () => "light",
    }).pipe(
      Effect.orElseSucceed((): typeof Theme.Type => "light"),
      Effect.map((theme) => ThemeLoaded.make({ theme })),
    ),
});
export const ThemeSaved = Schema.TaggedStruct("ThemeSaved", {});
export const SaveTheme = Command.define("SaveTheme", {
  args: { theme: Theme },
  messages: [ThemeSaved],
  execute: ({ theme }) =>
    Effect.try({
      try: () => localStorage.setItem("signaturekit-theme", theme),
      catch: () => undefined,
    }).pipe(Effect.ignore, Effect.as(ThemeSaved.make({}))),
});

export const HomeProvider = Schema.Literals([
  "Clicksign",
  "Assinafy",
  "ZapSign",
  "DocuSeal",
  "Documenso",
]);
export const HomeProviderSelected = Schema.TaggedStruct("HomeProviderSelected", {
  provider: HomeProvider,
});
export const SelectHomeProvider = Command.define("SelectHomeProvider", {
  args: { provider: HomeProvider },
  messages: [HomeProviderSelected],
  execute: ({ provider }) =>
    Effect.sync(() => {
      captureDocsEvent("provider_showcase_selected", { method: "tab", provider });
      return HomeProviderSelected.make({ provider });
    }),
});
export const HomeCopyTarget = Schema.Literals([
  "install",
  "npm",
  "pnpm",
  "yarn",
  "provider",
  "first",
]);
export const HomeCopyLocation = Schema.Literals(["hero", "final_cta", "get_started", "providers"]);
export const HomeCopyRequest = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const HomeCopyFinished = Schema.TaggedStruct("HomeCopyFinished", {
  target: HomeCopyTarget,
  request: HomeCopyRequest,
  provider: HomeProvider,
  ok: Schema.Boolean,
});
export const HomeCopyExpired = Schema.TaggedStruct("HomeCopyExpired", {
  request: HomeCopyRequest,
  provider: HomeProvider,
});
export const ExpireHomeCopy = Command.define("ExpireHomeCopy", {
  args: { request: HomeCopyRequest, provider: HomeProvider },
  messages: [HomeCopyExpired],
  execute: ({ request, provider }) =>
    Effect.sleep("1800 millis").pipe(Effect.as(HomeCopyExpired.make({ request, provider }))),
});
export const CopyHome = Command.define("CopyHome", {
  args: {
    text: Schema.String,
    target: HomeCopyTarget,
    provider: HomeProvider,
    filename: Schema.String,
    location: HomeCopyLocation,
    request: HomeCopyRequest,
  },
  messages: [HomeCopyFinished],
  execute: ({ text, target, provider, filename, location, request }) =>
    Effect.tryPromise({
      try: async () => {
        await navigator.clipboard.writeText(text);
        if (target === "provider")
          captureDocsEvent("provider_snippet_copied", { filename, provider });
        else if (location === "hero" || location === "final_cta")
          captureDocsEvent("install_command_copied", { analytics_location: location });
        return HomeCopyFinished.make({ target, request, provider, ok: true });
      },
      catch: () => {
        if (target === "provider")
          captureDocsEvent("provider_snippet_copy_failed", { filename, provider });
        else if (location === "hero" || location === "final_cta")
          captureDocsEvent("install_command_copy_failed", { analytics_location: location });
        return HomeCopyFinished.make({ target, request, provider, ok: false });
      },
    }).pipe(Effect.catch((failure) => Effect.succeed(failure))),
});

export const homeProviders: ReadonlyArray<{
  name: typeof HomeProvider.Type;
  filename: string;
  code: string;
}> = [
  {
    name: "Clicksign",
    filename: "clicksign.ts",
    code: 'import * as Alchemy from "alchemy"\nimport { ClicksignSignatureRequest, providers as clicksignProviders } from "@signature-kit/clicksign"\nimport { signatureHttpClientLive } from "@signature-kit/http"\nimport { Effect, Layer, Redacted } from "effect"\n\nexport default class Contracts extends Alchemy.Stack<Contracts>()(\n  "Contracts",\n  {\n    providers: Layer.merge(\n      clicksignProviders({\n        accessToken: Redacted.make(process.env.CLICKSIGN_TOKEN ?? ""),\n        environment: "sandbox",\n        locale: "pt-BR",\n        autoClose: true,\n      }),\n      signatureHttpClientLive,\n    ),\n    state: Alchemy.inMemoryState(),\n  },\n  Effect.gen(function* () {\n    return yield* ClicksignSignatureRequest("membership-agreement", {\n      title: "Membership agreement",\n      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],\n      recipients: [{ name: "Bruno Lima", email: "bruno@example.com", role: "signer" }],\n    })\n  }),\n) {}',
  },
  {
    name: "Assinafy",
    filename: "assinafy.ts",
    code: 'import * as Alchemy from "alchemy"\nimport { AssinafySignatureRequest, providers as assinafyProviders } from "@signature-kit/assinafy"\nimport { signatureHttpClientLive } from "@signature-kit/http"\nimport { Effect, Layer, Redacted } from "effect"\n\nexport default class Contracts extends Alchemy.Stack<Contracts>()(\n  "Contracts",\n  {\n    providers: Layer.merge(\n      assinafyProviders({\n        accountId: process.env.ASSINAFY_ACCOUNT_ID ?? "",\n        apiKey: Redacted.make(process.env.ASSINAFY_API_KEY ?? ""),\n        environment: "sandbox",\n      }),\n      signatureHttpClientLive,\n    ),\n    state: Alchemy.inMemoryState(),\n  },\n  Effect.gen(function* () {\n    return yield* AssinafySignatureRequest("contract", {\n      title: "Contract",\n      documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],\n      recipients: [{ name: "Carla Nunes", email: "carla@example.com" }],\n    })\n  }),\n) {}',
  },
  {
    name: "ZapSign",
    filename: "zapsign.ts",
    code: 'import * as Alchemy from "alchemy"\nimport { ZapSignSignatureRequest, providers as zapSignProviders } from "@signature-kit/zapsign"\nimport { signatureHttpClientLive } from "@signature-kit/http"\nimport { Effect, Layer, Redacted } from "effect"\n\nexport default class Contracts extends Alchemy.Stack<Contracts>()(\n  "Contracts",\n  {\n    providers: Layer.merge(\n      zapSignProviders({\n        apiToken: Redacted.make(process.env.ZAPSIGN_API_TOKEN ?? ""),\n        environment: "sandbox",\n        locale: "pt-br",\n      }),\n      signatureHttpClientLive,\n    ),\n    state: Alchemy.inMemoryState(),\n  },\n  Effect.gen(function* () {\n    return yield* ZapSignSignatureRequest("contract", {\n      title: "Contract",\n      documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],\n      recipients: [{ name: "Davi Rocha", email: "davi@example.com" }],\n    })\n  }),\n) {}',
  },
  {
    name: "DocuSeal",
    filename: "docuseal.ts",
    code: 'import * as Alchemy from "alchemy"\nimport { DocuSealSignatureRequest, providers as docuSealProviders } from "@signature-kit/docuseal"\nimport { signatureHttpClientLive } from "@signature-kit/http"\nimport { Effect, Layer, Redacted } from "effect"\n\nexport default class Contracts extends Alchemy.Stack<Contracts>()(\n  "Contracts",\n  {\n    providers: Layer.merge(\n      docuSealProviders({\n        apiKey: Redacted.make(process.env.DOCUSEAL_API_KEY ?? ""),\n        baseUrl: "https://api.docuseal.com",\n        submittersOrder: "preserved",\n      }),\n      signatureHttpClientLive,\n    ),\n    state: Alchemy.inMemoryState(),\n  },\n  Effect.gen(function* () {\n    return yield* DocuSealSignatureRequest("service-agreement", {\n      title: "Service agreement",\n      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],\n      recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "signer" }],\n    })\n  }),\n) {}',
  },
  {
    name: "Documenso",
    filename: "documenso.ts",
    code: 'import * as Alchemy from "alchemy"\nimport { DocumensoSignatureRequest, providers as documensoProviders } from "@signature-kit/documenso"\nimport { signatureHttpClientLive } from "@signature-kit/http"\nimport { Effect, Layer, Redacted } from "effect"\n\nexport default class Contracts extends Alchemy.Stack<Contracts>()(\n  "Contracts",\n  {\n    providers: Layer.merge(\n      documensoProviders({\n        apiKey: Redacted.make(process.env.DOCUMENSO_API_KEY ?? ""),\n        baseUrl: "https://app.documenso.com/api/v2",\n      }),\n      signatureHttpClientLive,\n    ),\n    state: Alchemy.inMemoryState(),\n  },\n  Effect.gen(function* () {\n    return yield* DocumensoSignatureRequest("service-agreement", {\n      title: "Service agreement",\n      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],\n      recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "approver", routingOrder: 1 }],\n    })\n  }),\n) {}',
  },
];
export const firstSignature =
  'import { a1SignaturesLayer } from "@signature-kit/a1/signer"\nimport { signatures } from "@signature-kit/signatures"\nimport { Effect, Redacted } from "effect"\n\nconst layer = a1SignaturesLayer({\n  pfx,\n  password: Redacted.make(process.env.A1_PASSWORD ?? ""),\n})\n\nconst program = Effect.gen(function* () {\n  const identity = yield* signatures.inspect()\n\n  const artifact = yield* signatures.sign({\n    content,\n    algorithm: "rsa-sha256",\n  })\n\n  return { identity, artifact }\n}).pipe(Effect.provide(layer))\n\nconst { identity, artifact } = await Effect.runPromise(program)';
export const installCommand = "bun add @signature-kit/signatures @signature-kit/a1";

export const signFreeDescription =
  "Assine documentos PDF grátis no navegador com certificado digital A1. O arquivo, o .p12/.pfx e a senha ficam no seu dispositivo.";
export const signFreeSteps = [
  { title: "Envie o PDF", body: "Lido como bytes no navegador. Nenhum upload acontece." },
  {
    title: "Posicione a assinatura",
    body: "Clique no ponto da assinatura ou use o posicionamento automático.",
  },
  { title: "Carregue o A1", body: "Selecione o .p12 ou .pfx e informe a senha. Tudo fica local." },
  { title: "Baixe assinado", body: "A assinatura PAdES é aplicada na página e o PDF sai pronto." },
];
export const signFreeFaqs = [
  { question: "Precisa de cadastro?", answer: "Não. Basta o PDF e um certificado A1 válido." },
  {
    question: "O documento vai para algum servidor?",
    answer: "Não. PDF, certificado e senha ficam em memória local durante a assinatura.",
  },
  { question: "Funciona com A3?", answer: "Ainda não. Esta página assina apenas com A1." },
];
export const signFreeLanding = <Message>(h: HtmlBuilder<Message>, signer: Html) => [
  h.section(
    [h.Class("home-section")],
    [
      h.p([h.Class("home-eyebrow")], ["Ferramenta grátis"]),
      h.h1([], ["Assine documentos grátis com A1 no navegador."]),
      h.p(
        [],
        [
          "Assinatura PAdES com certificado digital A1, direto no navegador. O PDF não sobe para servidor e a senha não é armazenada.",
        ],
      ),
      h.a([h.Class("home-action"), h.Href("#assinar")], ["Assinar agora"]),
      h.a(
        [h.Href(pageRoute({ locale: "pt-BR", path: "docs/a1-signing/browser-pdf-flow" }))],
        ["Como funciona"],
      ),
      h.ul(
        [],
        [
          "Sem upload do PDF",
          "Sem cadastro",
          "Senha nunca sai da página",
          "Assinatura PAdES com A1",
        ].map((item) => h.li([], [item])),
      ),
    ],
  ),
  h.section(
    [h.Class("home-section")],
    [
      h.h2([], ["Quatro passos, tudo no navegador."]),
      h.div(
        [h.Class("home-grid")],
        signFreeSteps.map((step) =>
          h.article([h.Class("home-card")], [h.h3([], [step.title]), h.p([], [step.body])]),
        ),
      ),
    ],
  ),
  h.section(
    [h.Class("home-section"), h.Id("assinar")],
    [
      h.h2([], ["Assine seu documento agora."]),
      h.p([], ["Tenha o PDF, o certificado A1 (.p12 ou .pfx) e a senha em mãos."]),
      signer,
    ],
  ),
  h.section(
    [h.Class("home-section")],
    [
      h.h2([], ["Perguntas frequentes"]),
      h.div(
        [h.Class("home-grid")],
        signFreeFaqs.map((item) =>
          h.article([h.Class("home-card")], [h.h3([], [item.question]), h.p([], [item.answer])]),
        ),
      ),
    ],
  ),
];

export const homeView = <Message>(
  h: HtmlBuilder<Message>,
  state: {
    locale: Locale;
    provider: typeof HomeProvider.Type;
    copied: typeof HomeCopyTarget.Type | "none" | "failed";
  },
  signer: Html,
  demo: Html,
  messages: {
    select: (provider: typeof HomeProvider.Type) => Message;
    copy: (target: typeof HomeCopyTarget.Type, location: typeof HomeCopyLocation.Type) => Message;
  },
) => {
  const copy = state.locale === "pt-BR" ? pt : en;
  const selected = homeProviders.find((provider) => provider.name === state.provider);
  const providerCode = selected?.code ?? "";
  const providerFile = selected?.filename ?? "";
  const section = (id: string, eyebrow: string, title: string, lead: string) => [
    h.p([h.Class("home-eyebrow")], [eyebrow]),
    h.h2([h.Id(id)], [title]),
    h.p([h.Class("home-lead")], [lead]),
  ];
  const copyButton = (target: typeof HomeCopyTarget.Type, location: typeof HomeCopyLocation.Type) =>
    Button.view(
      {
        onClick: messages.copy(target, location),
        toView: (attributes) =>
          h.button(
            [
              ...attributes.button,
              h.Class("home-copy"),
              h.Attribute(
                "aria-label",
                target === "provider"
                  ? `${copy.showcase_copy} ${state.provider}`
                  : target === "first"
                    ? `${copy.showcase_copy} first-signature.ts`
                    : `${copy.install_copy_label} ${target === "install" ? "bun" : target}`,
              ),
            ],
            [state.copied === target ? copy.showcase_copied : copy.showcase_copy],
          ),
      },
      h,
    );
  const capabilities = [
    [
      copy.cap1_title,
      copy.cap1_desc,
      "signing/signers",
      'import { signatures } from "@signature-kit/signatures"',
    ],
    [
      copy.cap2_title,
      copy.cap2_desc,
      "get-started/quickstart",
      "a1SignaturesLayer({ pfx, password: Redacted.make(password) })",
    ],
    [
      copy.cap3_title,
      copy.cap3_desc,
      "signing/pdf",
      'signPdf({ pdf, policy: "pades-icp-brasil" })',
    ],
    [copy.cap4_title, copy.cap4_desc, "signing/xml", 'signXml({ xml, referenceId: "nfe-1" })'],
    [
      copy.cap5_title,
      copy.cap5_desc,
      "providers/request-shape",
      'ClicksignSignatureRequest("contract", props)',
    ],
    [
      copy.cap6_title,
      state.locale === "pt-BR"
        ? "Falhas usam códigos tipados no canal de erros do Effect."
        : "Failures use typed codes in the Effect error channel.",
      "signing/errors",
      'Effect.catchTag("SignatureKitError", handle)',
    ],
    [
      copy.cap7_title,
      copy.cap7_desc,
      "a1-signing/browser-pdf-flow",
      'import { signPdfSignatureField } from "@signature-kit/pdf/workflow"',
    ],
  ];
  return [
    h.section(
      [h.Class("home-hero")],
      [
        h.a(
          [h.Class("home-eyebrow"), h.Href("https://github.com/Licitei/signature-kit")],
          [copy.hero_badge],
        ),
        h.h1([], [copy.hero_title]),
        h.p([h.Class("home-lead")], [copy.hero_subhead]),
        h.div(
          [h.Class("home-actions")],
          [
            h.code([], [installCommand]),
            copyButton("install", "hero"),
            h.a([h.Href(pageRoute({ locale: state.locale, path: "docs" }))], [copy.hero_cta_docs]),
          ],
        ),
      ],
    ),
    h.section(
      [h.Class("home-integrations"), h.Attribute("aria-label", copy.showcase_eyebrow)],
      homeProviders.map((provider) => h.span([], [provider.name])),
    ),
    h.section(
      [h.Class("home-section"), h.Id("signer")],
      [
        ...section("signer-heading", copy.signer_eyebrow, copy.signer_title, copy.signer_lead),
        h.div(
          [h.Class("home-grid")],
          [
            h.div(
              [],
              [
                h.h3([], [copy.signer_step1_title]),
                h.p(
                  [],
                  [
                    state.locale === "pt-BR"
                      ? "Prévia local, sem upload."
                      : "Local preview, without upload.",
                  ],
                ),
              ],
            ),
            h.div([], [h.h3([], [copy.signer_step2_title]), h.p([], [copy.signer_step2_body])]),
            h.div([], [h.h3([], [copy.signer_step3_title]), h.p([], [copy.signer_step3_body])]),
          ],
        ),
        h.p([], [copy.signer_assurance]),
        h.a(
          [
            h.Class("home-action"),
            h.Href(
              pageRoute({
                locale: state.locale,
                path: state.locale === "pt-BR" ? "assine-documentos-gratis" : "sign-free",
              }),
            ),
          ],
          [copy.signer_open],
        ),
      ],
    ),
    h.section(
      [h.Class("home-section"), h.Id("auto-sign")],
      [
        ...section(
          "auto-sign-heading",
          copy.autosign_eyebrow,
          copy.autosign_title,
          state.locale === "pt-BR"
            ? "Posicione e assine vários PDFs em sequência com seu certificado A1 no navegador."
            : "Place and sign several PDFs in sequence with your A1 certificate in the browser.",
        ),
        h.p(
          [],
          [
            state.locale === "pt-BR"
              ? "A assinatura e os downloads usam o assinador real no seu dispositivo."
              : "Signing and downloads use the real signer on your device.",
          ],
        ),
        demo,
        signer,
      ],
    ),
    h.section(
      [h.Class("home-section"), h.Id("providers")],
      [
        ...section(
          "providers-heading",
          copy.showcase_eyebrow,
          copy.showcase_title,
          state.locale === "pt-BR"
            ? "Cinco provedores remotos, com contratos próprios e uma fronteira HTTP compartilhada."
            : "Five remote providers, each with its own contract and a shared HTTP boundary.",
        ),
        h.div(
          [
            h.Class("home-providers"),
            h.Attribute("role", "group"),
            h.Attribute("aria-label", copy.showcase_card_provider),
          ],
          homeProviders.map((provider) =>
            Button.view(
              {
                onClick: messages.select(provider.name),
                toView: (attributes) =>
                  h.button(
                    [
                      ...attributes.button,
                      h.Attribute("aria-pressed", String(provider.name === state.provider)),
                    ],
                    [provider.name],
                  ),
              },
              h,
            ),
          ),
        ),
        h.div(
          [h.Class("home-code")],
          [
            h.p([], [providerFile]),
            h.pre([], [h.code([], [providerCode])]),
            copyButton("provider", "providers"),
          ],
        ),
        h.div(
          [h.Class("home-grid")],
          [
            [copy.showcase_feature_adapters_label, copy.showcase_feature_adapters_desc],
            [copy.showcase_feature_errors_label, copy.showcase_feature_errors_desc],
            [copy.showcase_feature_redacted_label, copy.showcase_feature_redacted_desc],
            [copy.showcase_feature_shape_label, copy.showcase_feature_shape_desc],
          ].map(([title, description]) =>
            h.article(
              [h.Class("home-card")],
              [h.h3([], [title ?? ""]), h.p([], [description ?? ""])],
            ),
          ),
        ),
        h.a(
          [h.Href(pageRoute({ locale: state.locale, path: "docs/providers/request-shape" }))],
          [copy.showcase_cta_browse],
        ),
      ],
    ),
    h.section(
      [h.Class("home-section"), h.Id("capabilities")],
      [
        ...section(
          "capabilities-heading",
          copy.cap_eyebrow,
          copy.cap_title,
          state.locale === "pt-BR"
            ? "A1, PDF, XML e provedores remotos com erros tipados."
            : "A1, PDF, XML and remote providers with typed errors.",
        ),
        h.div(
          [h.Class("home-grid")],
          capabilities.map(([title, description, path, code]) =>
            h.article(
              [h.Class("home-card")],
              [
                h.h3([], [title ?? ""]),
                h.p([], [description ?? ""]),
                h.code([], [code ?? ""]),
                h.a(
                  [h.Href(pageRoute({ locale: state.locale, path: `docs/${path}` }))],
                  [copy.cap_read_docs],
                ),
              ],
            ),
          ),
        ),
      ],
    ),
    h.section(
      [h.Class("home-section"), h.Id("get-started")],
      [
        ...section("get-started-heading", copy.gs_eyebrow, copy.gs_title, copy.gs_lead),
        h.h3([], [copy.gs_step1_heading]),
        h.pre([], [h.code([], [installCommand])]),
        copyButton("install", "get_started"),
        h.pre([], [h.code([], ["npm install @signature-kit/signatures @signature-kit/a1"])]),
        copyButton("npm", "get_started"),
        h.pre([], [h.code([], ["pnpm add @signature-kit/signatures @signature-kit/a1"])]),
        copyButton("pnpm", "get_started"),
        h.pre([], [h.code([], ["yarn add @signature-kit/signatures @signature-kit/a1"])]),
        copyButton("yarn", "get_started"),
        h.p([], [copy.gs_note1, " /a1 · /pdf · /xml"]),
        h.h3([], [copy.gs_step2_heading]),
        h.pre([], [h.code([], [firstSignature])]),
        copyButton("first", "get_started"),
      ],
    ),
    h.section(
      [h.Class("home-section home-sponsor"), h.Id("sponsors")],
      [h.p([], [copy.sponsors_eyebrow]), h.a([h.Href("https://licitei.com.br")], ["Licitei"])],
    ),
    h.section(
      [h.Class("home-section home-final")],
      [
        h.p([], [copy.final_eyebrow]),
        h.h2([], [copy.final_title]),
        h.p([], [copy.final_lead]),
        h.a(
          [
            h.Class("home-action"),
            h.Href(pageRoute({ locale: state.locale, path: "docs/get-started/quickstart" })),
          ],
          [copy.final_cta],
        ),
        h.pre([], [h.code([], [installCommand])]),
        copyButton("install", "final_cta"),
      ],
    ),
    h.p(
      [h.Attribute("role", "status"), h.Class("home-status")],
      [
        state.copied === "failed"
          ? state.locale === "pt-BR"
            ? "Não foi possível copiar."
            : "Could not copy."
          : state.copied === "none"
            ? ""
            : copy.showcase_copied,
      ],
    ),
  ];
};
