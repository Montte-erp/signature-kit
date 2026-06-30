import { PostHog } from "posthog-node";

import { docsAnalyticsProperties, docsEventName } from "@/lib/posthog/events";

const POSTHOG_PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

type AnalyticsProperty = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsProperty>;

const posthog =
  POSTHOG_PROJECT_TOKEN === undefined || POSTHOG_PROJECT_TOKEN.length === 0
    ? undefined
    : new PostHog(POSTHOG_PROJECT_TOKEN, {
        host: POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
      });

const distinctIdFor = (route: string, request: Request): string => {
  const forwarded = request.headers.get("x-posthog-distinct-id");
  if (forwarded !== null && forwarded.length > 0) return forwarded;

  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return `docs-server:${route}:${userAgent}`;
};

export const captureServerEvent = (
  event: string,
  request: Request,
  properties: AnalyticsProperties = {},
): Promise<void> => {
  if (posthog === undefined) return Promise.resolve();

  const url = new URL(request.url);
  posthog.capture({
    distinctId: distinctIdFor(url.pathname, request),
    event: docsEventName(event),
    properties: {
      ...docsAnalyticsProperties("server"),
      ...properties,
      route: url.pathname,
      search: url.search || undefined,
      referrer: request.headers.get("referer") ?? undefined,
      user_agent: request.headers.get("user-agent") ?? undefined,
    },
  });

  return posthog.flush().catch(() => undefined);
};
