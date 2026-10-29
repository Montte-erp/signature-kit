import { Config, Duration, Effect, Fiber, Option, Schedule, Schema } from "effect";
import { HttpClient } from "effect/http";
import { serve } from "@foldkit/node";

import { localHttpServer } from "../../../tooling/testing/local-http.ts";

const ContentTestHostOptions = Schema.Struct({
  manifestPath: Schema.String,
  rootDirectory: Schema.String,
});

export const contentTestHost = Effect.fn(function* (options: typeof ContentTestHostOptions.Type) {
  const origin = yield* Effect.scoped(
    localHttpServer(async () => ({ status: 204 })).pipe(Effect.map((server) => server.baseUrl)),
  );
  const port = yield* Schema.decodeUnknownEffect(Schema.FiniteFromString)(new URL(origin).port);
  const host = yield* Effect.forkScoped(
    serve({
      port: Config.succeed(port),
      origin: Config.succeed(Option.some(origin)),
      manifestPath: options.manifestPath,
      rootDirectory: options.rootDirectory,
    }),
  );
  const ready = yield* Effect.raceFirst(
    Fiber.join(host),
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* HttpClient.get(origin + "/r/registry.json");
        const body = yield* response.text;
        return { status: response.status, body };
      }),
    ).pipe(
      Effect.timeout(Duration.millis(500)),
      Effect.retry({
        schedule: Schedule.spaced(Duration.millis(100)),
        while: (issue) => issue._tag === "TimeoutError" || issue.reason._tag === "TransportError",
      }),
      Effect.timeoutOrElse({
        duration: Duration.seconds(10),
        orElse: () => Effect.die("Native host readiness did not complete"),
      }),
    ),
  );
  if (ready.status !== 200 || ready.body.length === 0)
    return yield* Effect.die("Native host must serve its public registry before accepting tests");
  return origin;
});
