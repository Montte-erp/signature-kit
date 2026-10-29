import { Effect, Layer } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { HttpRouter, HttpServer } from "effect/http";
import { FeedbackError, PageFeedback } from "./config.ts";

export const FeedbackApi = HttpApi.make("FeedbackApi").add(
  HttpApiGroup.make("feedback").add(
    HttpApiEndpoint.post("submitPage", "/api/feedback/page", {
      payload: PageFeedback,
      error: FeedbackError.pipe(HttpApiSchema.status(503)),
    }),
  ),
);

const handlers = HttpApiBuilder.group(FeedbackApi, "feedback", (group) =>
  group.handle("submitPage", () => Effect.fail(new FeedbackError({ code: "unavailable" }))),
);

const feedbackApiLayer = HttpApiBuilder.layer(FeedbackApi).pipe(
  Layer.provide(handlers),
  Layer.provide(HttpServer.layerServices),
);

export const feedbackResponse = Effect.fn(function* (request: Request) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const application = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(feedbackApiLayer, { disableLogger: true })),
        (handler) => Effect.promise(() => handler.dispose()),
      );
      return yield* Effect.promise(() => application.handler(request));
    }),
  );
});
