import { Config, Effect, Option } from "effect";

export const enabledEnv = (name: string): Config.Config<boolean> =>
  Config.String(name).pipe(
    Config.withDefault("0"),
    Config.map((value) => value === "1"),
  );

export const requiredEnv = (name: string): Config.Config<string> => Config.NonEmptyString(name);

export const optionalEnv = (name: string): Config.Config<string | undefined> =>
  Config.NonEmptyString(name).pipe(Config.option, Config.map(Option.getOrUndefined));

export const optionalIntEnv = (name: string): Config.Config<number | undefined> =>
  Config.Int(name).pipe(Config.option, Config.map(Option.getOrUndefined));

export const optionalStringLiteralEnv = <const L extends ReadonlyArray<string>>(
  name: string,
  literals: L,
): Config.Config<L[number] | undefined> =>
  Config.Literals(literals, name).pipe(Config.option, Config.map(Option.getOrUndefined));

export const loadFlaggedConfig = <A>(flagName: string, config: Config.Config<A>): A | undefined =>
  Effect.runSync(
    Effect.gen(function* () {
      const enabled = yield* enabledEnv(flagName);
      if (!enabled) return undefined;
      return yield* config;
    }),
  );
