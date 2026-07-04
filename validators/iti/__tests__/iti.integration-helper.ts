import { readFile } from "node:fs/promises";
import { Config, Effect } from "effect";
import { toArrayBufferView } from "../../../tooling/testing/fixtures";
import { loadFlaggedConfig, optionalIntEnv } from "../../../tooling/testing/env";

export const DEFAULT_EXPECTED_STATUS_WITH_FIXTURE = 406;
export const DEFAULT_EXPECTED_STATUS_WITH_TRUSTED_FIXTURE = 200;
export const SIGNED_FIXTURE = "icp-brasil-ad-rb-signed.pdf";

export const itiIntegrationConfig = loadFlaggedConfig(
  "SIGNATURE_KIT_ITI_VALIDATE",
  Config.all({
    expectedStatus: optionalIntEnv("SIGNATURE_KIT_ITI_EXPECT_STATUS"),
  }),
);

export const readItiFixture = (name: string): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))),
  );

export const expectedStatus = (expectedStatusOverride: number | undefined): number =>
  expectedStatusOverride ?? DEFAULT_EXPECTED_STATUS_WITH_FIXTURE;

export const sha256Hex = (bytes: Uint8Array): Effect.Effect<string> =>
  Effect.promise(async () => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBufferView(bytes)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
