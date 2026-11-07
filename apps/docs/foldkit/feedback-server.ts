import { Effect, Result, Schema } from "effect";
import { resolveContent } from "./content";
import {
  AnalyticsDeliveryError,
  defaultServerAnalyticsLayer,
  ServerAnalytics,
} from "../lib/posthog/server";

const BoundedText = Schema.String.check(Schema.isMaxLength(2000));
const Route = Schema.String.check(Schema.isMaxLength(200));
const PageFeedback = Schema.Struct({
  route: Route,
  opinion: Schema.Literals(["good", "bad"]),
  message: BoundedText,
});
const TextFeedback = Schema.Struct({
  route: Route,
  blockId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  blockBody: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  message: BoundedText,
});

const feedbackResponseWithAnalytics = (
  request: Request,
): Effect.Effect<Response | undefined, never, ServerAnalytics> =>
  Effect.gen(function* () {
    const path = new URL(request.url).pathname;
    if (path !== "/api/feedback/page" && path !== "/api/feedback/text") return undefined;
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return new Response(null, { status: 415 });
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > 8192) return new Response(null, { status: 413 });
    const body = yield* Effect.tryPromise({
      try: async () => {
        if (request.body === null) return "";
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return text + decoder.decode();
          size += chunk.value.length;
          if (size > 8192) {
            await reader.cancel();
            return null;
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      },
      catch: () => null,
    }).pipe(Effect.option);
    if (body._tag === "None") return new Response(null, { status: 400 });
    if (body.value === null) return new Response(null, { status: 413 });
    const rawBody = body.value;
    const json = yield* Effect.try({ try: () => JSON.parse(rawBody), catch: () => null }).pipe(
      Effect.option,
    );
    if (json._tag === "None") return new Response(null, { status: 400 });
    const decoded = yield* Schema.decodeUnknownEffect(
      path.endsWith("/page") ? PageFeedback : TextFeedback,
      { onExcessProperty: "error" },
    )(json.value).pipe(Effect.option);
    if (decoded._tag === "None") return new Response(null, { status: 400 });
    const data = decoded.value;
    const match = /^\/(en-US|pt-BR)\/docs(?:\/(.*))?$/.exec(data.route);
    if (
      match === null ||
      resolveContent(match[1] === "pt-BR" ? "pt-BR" : "en-US", "docs", match[2] ?? "") === undefined
    )
      return new Response(null, { status: 400 });
    const analytics = yield* ServerAnalytics;
    const result = yield* analytics
      .capture(
        "opinion" in data ? "page_feedback_submitted" : "text_feedback_submitted",
        "docs-server:internal",
        "opinion" in data
          ? { route: data.route, opinion: data.opinion, message: data.message }
          : {
              route: data.route,
              block_id: data.blockId,
              block_body: data.blockBody,
              message: data.message,
            },
      )
      .pipe(Effect.result);
    if (Result.isFailure(result)) return new Response(null, { status: 503 });
    return Response.json({});
  });

export const feedbackResponse = (
  request: Request,
  analytics?: typeof ServerAnalytics.Service | null,
): Effect.Effect<Response | undefined> => {
  if (analytics != null)
    return feedbackResponseWithAnalytics(request).pipe(
      Effect.provideService(ServerAnalytics, analytics),
    );
  if (analytics !== null && defaultServerAnalyticsLayer !== undefined) {
    const path = new URL(request.url).pathname;
    if (path !== "/api/feedback/page" && path !== "/api/feedback/text")
      return Effect.succeed(undefined);
    return feedbackResponseWithAnalytics(request).pipe(
      Effect.provide(defaultServerAnalyticsLayer),
      Effect.orDie,
    );
  }
  return feedbackResponseWithAnalytics(request).pipe(
    Effect.provideService(
      ServerAnalytics,
      ServerAnalytics.of({
        capture: () =>
          Effect.fail(
            new AnalyticsDeliveryError({
              code: "unconfigured",
              reason: "PostHog is not configured",
            }),
          ),
      }),
    ),
  );
};
