export type DocsAnalyticsRuntime = "client" | "server";

export const DOCS_ANALYTICS_EVENT_PREFIX =
  process.env.NEXT_PUBLIC_POSTHOG_EVENT_PREFIX ?? "signaturekit_docs";

export const docsEventName = (event: string): string => `${DOCS_ANALYTICS_EVENT_PREFIX}_${event}`;

export const docsAnalyticsProperties = (runtime: DocsAnalyticsRuntime) => ({
  app: "signaturekit-docs",
  analytics_runtime: runtime,
  event_prefix: DOCS_ANALYTICS_EVENT_PREFIX,
  source_product: "signature-kit",
  source_surface: "docs",
  owning_company: "montte",
});
