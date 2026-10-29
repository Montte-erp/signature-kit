import { Effect, Result } from "effect";
import { HttpApiClient } from "effect/http-api";
import * as Http from "foldkit/http";
import { expect, it } from "vitest";

import { FeedbackApi } from "../src/feedback/api.ts";

it("reaches the feedback API on the published documentation origin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/en-US/docs/get-started/installation";
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () =>
                frame.contentDocument?.querySelector<HTMLSelectElement>("#site-theme")?.disabled,
            )
            .toBe(false),
        );
        const client = yield* HttpApiClient.make(FeedbackApi, {
          baseUrl: new URL(frame.src).origin,
        });
        const result = yield* Effect.result(
          client.feedback.submitPage({
            payload: {
              route: "/en-US/docs/get-started/installation",
              opinion: "good",
              message: "The installation instructions are clear.",
            },
          }),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result))
          expect(result.failure).toMatchObject({ _tag: "FeedbackError", code: "unavailable" });
      }),
    ).pipe(Effect.provide(Http.layer)),
    { signal },
  );
}, 30000);
