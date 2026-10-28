import { Match, Schema } from "effect";

export const PackageManager = Schema.Literals(["bun", "npm", "pnpm", "yarn"]);
export type PackageManager = typeof PackageManager.Type;

export const packageInstallCommand = (manager: PackageManager, packages: string): string =>
  Match.value(manager).pipe(
    Match.when("bun", () => "bun add"),
    Match.when("npm", () => "npm install"),
    Match.when("pnpm", () => "pnpm add"),
    Match.when("yarn", () => "yarn add"),
    Match.exhaustive,
  ) +
  " " +
  packages;
