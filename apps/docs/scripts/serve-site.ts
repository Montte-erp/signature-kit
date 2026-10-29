import { Config } from "effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serve } from "@foldkit/node";

NodeRuntime.runMain(
  serve({
    port: Config.Port("PORT").pipe(Config.withDefault(3001)),
    origin: Config.option(Config.String("ORIGIN")),
  }),
);
