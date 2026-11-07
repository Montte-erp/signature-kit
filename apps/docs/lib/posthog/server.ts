import { PostHog } from "posthog-node";
import { Context, Effect, Layer, Schema } from "effect";

import { docsAnalyticsProperties, docsEventName } from "./events";

const POSTHOG_PROJECT_TOKEN = import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = import.meta.env.WAKU_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type AnalyticsProperty = string | number | boolean | null | undefined;
export type AnalyticsProperties = Record<string, AnalyticsProperty>;

export const PostHogConfig = Schema.Struct({
  token: Schema.String.check(Schema.isMinLength(1)),
  host: Schema.String,
});

export class AnalyticsDeliveryError extends Schema.TaggedError<
  AnalyticsDeliveryError,
  { readonly brand: unique symbol }
>()("AnalyticsDeliveryError", {
  code: Schema.Literals(["unconfigured", "deliveryFailed"]),
  reason: Schema.String,
  status: Schema.optional(Schema.Finite),
}) {}

export class ServerAnalytics extends Context.Service<
  ServerAnalytics,
  {
    readonly capture: (
      event: string,
      distinctId: string,
      properties: AnalyticsProperties,
    ) => Effect.Effect<void, AnalyticsDeliveryError>;
  }
>()("docs/ServerAnalytics") {}

const createPostHog = (options: typeof PostHogConfig.Type) =>
  new PostHog(options.token, {
    host: options.host,
    flushAt: 100,
    flushInterval: 0,
    disableGeoip: true,
  });

const makeAnalytics = (posthog: PostHog) => {
  let pending: Promise<void> = Promise.resolve();
  return ServerAnalytics.of({
    capture: (event, distinctId, properties) =>
      Effect.promise(() => {
        const delivery = pending.then(async () => {
          posthog.capture({
            distinctId,
            event: docsEventName(event),
            properties: { ...docsAnalyticsProperties("server"), ...properties },
          });
          await posthog.flush();
        });
        pending = delivery.catch(() => undefined);
        return delivery.then(
          () => Effect.void,
          (cause: unknown) =>
            Schema.decodeUnknownEffect(
              Schema.Union([
                Schema.Struct({ name: Schema.Literal("PostHogFetchNetworkError") }),
                Schema.Struct({
                  name: Schema.Literal("PostHogFetchHttpError"),
                  status: Schema.Finite,
                }),
              ]),
            )(cause).pipe(
              Effect.catch(() => Effect.die(cause)),
              Effect.flatMap((error) =>
                Effect.fail(
                  new AnalyticsDeliveryError({
                    code: "deliveryFailed",
                    reason: "PostHog delivery failed",
                    ...(error.name === "PostHogFetchHttpError" ? { status: error.status } : {}),
                  }),
                ),
              ),
            ),
        );
      }).pipe(Effect.flatten),
  });
};

export const serverAnalyticsLayer = (config: typeof PostHogConfig.Type) =>
  Layer.effect(
    ServerAnalytics,
    Effect.gen(function* () {
      const options = yield* Schema.decodeUnknownEffect(PostHogConfig)(config);
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => createPostHog(options)),
        (client) => Effect.promise(() => client.shutdown()),
      );
      return makeAnalytics(client);
    }),
  );

export const defaultServerAnalyticsLayer =
  POSTHOG_PROJECT_TOKEN === undefined || POSTHOG_PROJECT_TOKEN.length === 0
    ? undefined
    : serverAnalyticsLayer({ token: POSTHOG_PROJECT_TOKEN, host: POSTHOG_HOST });

const captureEvent = (event: string, distinctId: string, properties: AnalyticsProperties = {}) =>
  Effect.gen(function* () {
    const analytics = yield* ServerAnalytics;
    yield* analytics.capture(event, distinctId, properties);
  });

const SERVER_DISTINCT_ID = "docs-server";
const INTERNAL_DISTINCT_ID = "docs-server:internal";

export const captureServerEventEffect = (
  event: string,
  request: Request,
  properties: AnalyticsProperties = {},
) =>
  captureEvent(event, SERVER_DISTINCT_ID, {
    ...properties,
    route: new URL(request.url).pathname.slice(0, 128),
  });

export const captureServerEventWithoutRequestEffect = (
  event: string,
  properties: AnalyticsProperties = {},
) => captureEvent(event, INTERNAL_DISTINCT_ID, properties);

export const captureServerEvent = (
  event: string,
  request: Request,
  properties: AnalyticsProperties = {},
  layer = defaultServerAnalyticsLayer,
): Promise<void> => {
  if (layer === undefined) return Promise.resolve();
  return Effect.runPromise(
    captureServerEventEffect(event, request, properties).pipe(
      Effect.ignore,
      Effect.provide(layer),
      Effect.orDie,
    ),
  ).catch(() => undefined);
};

export const captureServerEventWithoutRequest = (
  event: string,
  properties: AnalyticsProperties = {},
  layer = defaultServerAnalyticsLayer,
): Promise<void> => {
  if (layer === undefined) return Promise.resolve();
  return Effect.runPromise(
    captureServerEventWithoutRequestEffect(event, properties).pipe(
      Effect.ignore,
      Effect.provide(layer),
      Effect.orDie,
    ),
  ).catch(() => undefined);
};
