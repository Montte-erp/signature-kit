import type { ConfigContext, ServerPlugin } from "fumapress";
import { PostHog } from "posthog-node";

import { docsAnalyticsProperties, docsEventName } from "@/lib/posthog/events";

const POSTHOG_PROJECT_TOKEN = import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = import.meta.env.WAKU_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type AnalyticsProperty = string | number | boolean | null | undefined;
export type AnalyticsProperties = Record<string, AnalyticsProperty>;

const posthog =
  POSTHOG_PROJECT_TOKEN === undefined || POSTHOG_PROJECT_TOKEN.length === 0
    ? undefined
    : new PostHog(POSTHOG_PROJECT_TOKEN, {
        host: POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
      });

const captureEvent = (
  event: string,
  distinctId: string,
  properties: AnalyticsProperties = {},
): Promise<void> => {
  if (posthog === undefined) return Promise.resolve();

  posthog.capture({
    distinctId,
    event: docsEventName(event),
    properties: {
      ...docsAnalyticsProperties("server"),
      ...properties,
    },
  });

  return posthog.flush().catch(() => undefined);
};

const SERVER_DISTINCT_ID = "docs-server";

export const captureServerEvent = (
  event: string,
  request: Request,
  properties: AnalyticsProperties = {},
): Promise<void> => {
  if (posthog === undefined) return Promise.resolve();

  const url = new URL(request.url);
  return captureEvent(event, SERVER_DISTINCT_ID, {
    ...properties,
    route: url.pathname.slice(0, 128),
  });
};

const INTERNAL_DISTINCT_ID = "docs-server:internal";

export const captureServerEventWithoutRequest = (
  event: string,
  properties: AnalyticsProperties = {},
): Promise<void> => captureEvent(event, INTERNAL_DISTINCT_ID, properties);

const routeEvents: Readonly<Record<string, string>> = {
  "/api/search": "search_requested",
};

export const docsAnalyticsPlugin = <
  C extends ConfigContext = ConfigContext,
>(): ServerPlugin<C> => ({
  name: "analytics:posthog",
  enforce: "post",
  createMiddlewares() {
    return [
      async ({ req }, next) => {
        const event = routeEvents[req.path];
        if (event === undefined) return next();

        await next();

        const query = new URL(req.url).searchParams.get("query");
        await captureServerEvent(event, req.raw, {
          query_present: query !== null && query.length > 0,
          query_length: Math.min(query?.length ?? 0, 256),
        });
      },
    ];
  },
});
