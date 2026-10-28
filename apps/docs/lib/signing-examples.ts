import { Schema } from "effect";

export const ProviderExample = Schema.Struct({
  name: Schema.String,
  domain: Schema.String,
  filename: Schema.String,
  code: Schema.String,
});

export const providerExamples = Schema.Array(ProviderExample).make([
  {
    name: "Clicksign",
    domain: "clicksign.com",
    filename: "clicksign.ts",
    code: `import * as Alchemy from "alchemy"
import { ClicksignSignatureRequest, providers as clicksignProviders } from "@signature-kit/clicksign"
import { signatureHttpClientLive } from "@signature-kit/http"
import { Effect, Layer, Redacted } from "effect"

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(
      clicksignProviders({
        accessToken: Redacted.make(process.env.CLICKSIGN_TOKEN ?? ""),
        environment: "sandbox",
        locale: "pt-BR",
        autoClose: true,
      }),
      signatureHttpClientLive,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* ClicksignSignatureRequest("membership-agreement", {
      title: "Membership agreement",
      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Bruno Lima", email: "bruno@example.com", role: "signer" }],
    })
  }),
) {}`,
  },
  {
    name: "Assinafy",
    domain: "assinafy.com.br",
    filename: "assinafy.ts",
    code: `import * as Alchemy from "alchemy"
import { AssinafySignatureRequest, providers as assinafyProviders } from "@signature-kit/assinafy"
import { signatureHttpClientLive } from "@signature-kit/http"
import { Effect, Layer, Redacted } from "effect"

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(
      assinafyProviders({
        accountId: process.env.ASSINAFY_ACCOUNT_ID ?? "",
        apiKey: Redacted.make(process.env.ASSINAFY_API_KEY ?? ""),
        environment: "sandbox",
      }),
      signatureHttpClientLive,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* AssinafySignatureRequest("contract", {
      title: "Contract",
      documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Carla Nunes", email: "carla@example.com" }],
    })
  }),
) {}`,
  },
  {
    name: "ZapSign",
    domain: "zapsign.co",
    filename: "zapsign.ts",
    code: `import * as Alchemy from "alchemy"
import { ZapSignSignatureRequest, providers as zapSignProviders } from "@signature-kit/zapsign"
import { signatureHttpClientLive } from "@signature-kit/http"
import { Effect, Layer, Redacted } from "effect"

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(
      zapSignProviders({
        apiToken: Redacted.make(process.env.ZAPSIGN_API_TOKEN ?? ""),
        environment: "sandbox",
        locale: "pt-br",
      }),
      signatureHttpClientLive,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* ZapSignSignatureRequest("contract", {
      title: "Contract",
      documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Davi Rocha", email: "davi@example.com" }],
    })
  }),
) {}`,
  },
  {
    name: "DocuSeal",
    domain: "docuseal.com",
    filename: "docuseal.ts",
    code: `import * as Alchemy from "alchemy"
import { DocuSealSignatureRequest, providers as docuSealProviders } from "@signature-kit/docuseal"
import { signatureHttpClientLive } from "@signature-kit/http"
import { Effect, Layer, Redacted } from "effect"

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(
      docuSealProviders({
        apiKey: Redacted.make(process.env.DOCUSEAL_API_KEY ?? ""),
        baseUrl: "https://api.docuseal.com",
        submittersOrder: "preserved",
      }),
      signatureHttpClientLive,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* DocuSealSignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "signer" }],
    })
  }),
) {}`,
  },
  {
    name: "Documenso",
    domain: "documenso.com",
    filename: "documenso.ts",
    code: `import * as Alchemy from "alchemy"
import { DocumensoSignatureRequest, providers as documensoProviders } from "@signature-kit/documenso"
import { signatureHttpClientLive } from "@signature-kit/http"
import { Effect, Layer, Redacted } from "effect"

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(
      documensoProviders({
        apiKey: Redacted.make(process.env.DOCUMENSO_API_KEY ?? ""),
        baseUrl: "https://app.documenso.com/api/v2",
      }),
      signatureHttpClientLive,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* DocumensoSignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "approver", routingOrder: 1 }],
    })
  }),
) {}`,
  },
]);

export const firstCallExample = `import { a1SignaturesLayer } from "@signature-kit/a1/signer"
import { signatures } from "@signature-kit/signatures"
import { Effect, Redacted } from "effect"

const layer = a1SignaturesLayer({
  pfx,
  password: Redacted.make(process.env.A1_PASSWORD ?? ""),
})

const program = Effect.gen(function* () {
  const identity = yield* signatures.inspect()

  const artifact = yield* signatures.sign({
    content,
    algorithm: "rsa-sha256",
  })

  return { identity, artifact }
}).pipe(Effect.provide(layer))

const { identity, artifact } = await Effect.runPromise(program)`;
