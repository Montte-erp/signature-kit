import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FadeIn } from "@/components/fade-in";
import { Button } from "@/components/ui/button";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

import { Container, Eyebrow, Section } from "./_shared";
import { ProviderCarousel, type ProviderCarouselItem } from "./provider-carousel";
import { brandLogoUrl } from "./provider-marks";

/**
 * Providers showcase — "one SDK for every signer".
 *
 * SERVER component (no "use client"): the <CodeBlock> is an async, shiki-server
 * highlighter, so every provider snippet is highlighted HERE, on the server, and
 * the resolved nodes are handed to the client <ProviderCarousel> as the parallel
 * `panels` prop (index-matched to `items`). The carousel never calls highlight()
 * itself — it only swaps which pre-rendered panel is visible. `brandLogoUrl` is
 * likewise resolved server-side so the client never reads NEXT_PUBLIC_LOGO_DEV_TOKEN.
 *
 * Left column = the pitch: eyebrow, the section title (rendered inline, NOT via
 * SectionHeading, to avoid a duplicate top-level heading), lead, two CTAs, and
 * four hairline label/desc feature rows. Right column = the interactive carousel.
 *
 * Pure-monochrome stone tokens only — no coral, no fd-* tokens.
 */

interface ProviderShowcase {
  readonly name: string;
  /** Domain used to resolve the real (greyscaled) brand logo. */
  readonly domain: string;
  /** CodeBlock label for this provider's snippet. */
  readonly filename: string;
  /** Verbatim, valid @signature-kit/* usage — lang="ts". */
  readonly code: string;
}

/**
 * The five remote providers, in display order. Every snippet is the SAME
 * request shape (title / documents / recipients) — only the `create*SignatureRequest`
 * call and its config change, which is the whole point of the section.
 */
const PROVIDERS_SHOWCASE: readonly ProviderShowcase[] = [
  {
    name: "Clicksign",
    domain: "clicksign.com",
    filename: "clicksign.ts",
    code: `import { createClicksignSignatureRequest } from "@signature-kit/clicksign"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = yield* createClicksignSignatureRequest(
  {
    accessToken: Redacted.make(process.env.CLICKSIGN_TOKEN ?? ""),
    environment: "sandbox",
    locale: "pt-BR",
    autoClose: true,
  },
  {
    title: "Membership agreement",
    documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", content: pdfBytes }],
    recipients: [{ name: "Bruno Lima", email: "bruno@example.com", role: "signer" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    name: "Assinafy",
    domain: "assinafy.com.br",
    filename: "assinafy.ts",
    code: `import { createAssinafySignatureRequest } from "@signature-kit/assinafy"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = yield* createAssinafySignatureRequest(
  {
    accountId: process.env.ASSINAFY_ACCOUNT_ID!,
    apiKey: Redacted.make(process.env.ASSINAFY_API_KEY ?? ""),
    environment: "sandbox",
  },
  {
    title: "Contract",
    documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", content: pdfBytes }],
    recipients: [{ name: "Carla Nunes", email: "carla@example.com", role: "signer" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    name: "ZapSign",
    domain: "zapsign.co",
    filename: "zapsign.ts",
    code: `import { createZapSignSignatureRequest } from "@signature-kit/zapsign"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = yield* createZapSignSignatureRequest(
  {
    apiToken: Redacted.make(process.env.ZAPSIGN_API_TOKEN ?? ""),
    environment: "sandbox",
    locale: "pt-br",
  },
  {
    title: "Contract",
    documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", content: pdfBytes }],
    recipients: [{ name: "Davi Rocha", email: "davi@example.com", role: "signer" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    name: "DocuSeal",
    domain: "docuseal.com",
    filename: "docuseal.ts",
    code: `import { createDocuSealSignatureRequest } from "@signature-kit/docuseal"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = yield* createDocuSealSignatureRequest(
  {
    apiKey: Redacted.make(process.env.DOCUSEAL_API_KEY ?? ""),
    baseUrl: "https://api.docuseal.com",
    submittersOrder: "preserved",
  },
  {
    title: "Service agreement",
    documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", content: pdfBytes }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "signer" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    name: "Documenso",
    domain: "documenso.com",
    filename: "documenso.ts",
    code: `import { createDocumensoSignatureRequest } from "@signature-kit/documenso"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = yield* createDocumensoSignatureRequest(
  {
    apiKey: Redacted.make(process.env.DOCUMENSO_API_KEY ?? ""),
    baseUrl: "https://app.documenso.com/api/v2",
  },
  {
    title: "Service agreement",
    documents: [{ fileName: "agreement.pdf", mimeType: "application/pdf", content: pdfBytes }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com", role: "approver", routingOrder: 1 }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
];

/** The four hairline label/desc rows under the CTAs. */
const FEATURES: ReadonlyArray<{ readonly label: () => string; readonly desc: () => string }> = [
  { label: m.showcase_feature_adapters_label, desc: m.showcase_feature_adapters_desc },
  { label: m.showcase_feature_errors_label, desc: m.showcase_feature_errors_desc },
  { label: m.showcase_feature_redacted_label, desc: m.showcase_feature_redacted_desc },
  { label: m.showcase_feature_shape_label, desc: m.showcase_feature_shape_desc },
];

export function ProvidersShowcase() {
  // Build the plain-data items for the client carousel and the server-highlighted
  // panels in lock-step so panels[i] always belongs to items[i].
  const items: ProviderCarouselItem[] = PROVIDERS_SHOWCASE.map((provider) => ({
    name: provider.name,
    filename: provider.filename,
    logo: brandLogoUrl(provider.domain),
    code: provider.code,
  }));

  const panels = PROVIDERS_SHOWCASE.map((provider) => (
    <CodeBlock
      key={provider.filename}
      code={provider.code}
      lang="ts"
      className="!my-0 !rounded-none !border-0 bg-transparent text-[13px]"
    />
  ));

  return (
    <Section>
      <Container>
        <FadeIn delay={0.05}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
            {/* LEFT — the pitch */}
            <div className="lg:py-2">
              <Eyebrow>{m.showcase_eyebrow()}</Eyebrow>
              <h2 className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
                {m.showcase_title()}
              </h2>
              <p className="mt-4 max-w-[58ch] text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
                {m.showcase_lead()}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href={localePath("/docs")}>
                    {m.showcase_cta_docs()}
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={localePath("/docs/providers")}>
                    {m.showcase_cta_browse()}
                  </Link>
                </Button>
              </div>

              <dl className="mt-9 border-t border-border">
                {FEATURES.map((feature) => (
                  <div
                    key={feature.label()}
                    className="grid grid-cols-[7rem_1fr] gap-4 border-b border-border py-3.5"
                  >
                    <dt className="text-sm font-medium text-foreground">
                      {feature.label()}
                    </dt>
                    <dd className="text-sm leading-relaxed text-pretty text-muted-foreground">
                      {feature.desc()}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* RIGHT — interactive carousel (client), fed server-highlighted panels */}
            <div className="min-w-0">
              <ProviderCarousel items={items} panels={panels} />
            </div>
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
