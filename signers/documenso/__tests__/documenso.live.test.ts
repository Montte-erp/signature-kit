import { createPdfFixture } from "../../../tooling/testing/fixtures";
import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import {
  loadFlaggedConfig,
  optionalEnv,
  optionalStringLiteralEnv,
  requiredEnv,
} from "../../../tooling/testing/env";
import { Config, Effect, Redacted, Result } from "effect";
import {
  DocumensoSignatureRequest,
  providers as documensoProviders,
  cancelDocumensoSignatureRequest,
  deleteDocumensoSignatureRequest,
  getDocumensoSignatureRequest,
  listDocumensoSignatureRequests,
} from "../src/index";
import type { DocumensoEnvelopeProps, DocumensoProviderOptions } from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    apiKey: requiredEnv("DOCUMENSO_API_KEY"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("DOCUMENSO_BASE_URL"),
    authorizationScheme: optionalStringLiteralEnv("DOCUMENSO_AUTHORIZATION_SCHEME", ["bearer"]),
  }),
);

const documensoOptions = (liveConfig: NonNullable<typeof config>): DocumensoProviderOptions => ({
  apiKey: Redacted.make(liveConfig.apiKey),
  ...(liveConfig.baseUrl === undefined ? {} : { baseUrl: liveConfig.baseUrl }),
  ...(liveConfig.authorizationScheme === "bearer" ? { authorizationScheme: "bearer" } : {}),
});

const reconcileDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  request: DocumensoEnvelopeProps,
) =>
  Effect.gen(function* () {
    const provider = yield* Provider.findProvider(DocumensoSignatureRequest);
    return yield* provider.reconcile(reconcileResourceProps("documenso-live-request", request));
  }).pipe(Effect.provide(documensoProviders(options)), Effect.provide(signatureHttpClientLive));

if (config === undefined) {
  describe.skip("Documenso live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, DOCUMENSO_API_KEY and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const liveConfigValue = config;

  describe("Documenso live API", () => {
    it.effect(
      "runs the full create -> get -> list -> cancel -> delete lifecycle on the sandbox API",
      () =>
        Effect.gen(function* () {
          const options = documensoOptions(liveConfigValue);
          const input = {
            title: "SignatureKit live Documenso draft",
            subject: "SignatureKit live Documenso draft",
            message: "Created by SignatureKit live test.",
            documents: [
              {
                fileName: "signature-kit-live.pdf",
                mimeType: "application/pdf",
                contentBase64: Buffer.from(createPdfFixture()).toString("base64"),
              },
            ],
            recipients: [
              {
                name: "SignatureKit Live Recipient",
                email: liveConfigValue.recipientEmail,
                role: "signer",
                routingOrder: 1,
              },
            ],
            send: false,
          } satisfies DocumensoEnvelopeProps;

          const createResult = yield* Effect.result(
            reconcileDocumensoSignatureRequest(options, input),
          );
          if (Result.isFailure(createResult)) {
            const failure = createResult.failure;
            const rateLimited =
              failure.status === 429 ||
              (failure.status === 400 && failure.reason?.includes("LIMIT_EXCEEDED") === true);
            expect(rateLimited, failure.message).toBe(true);
            if (failure.status === 429) {
              expect(failure.retryable).toBe(true);
              expect(typeof failure.retryAfterEpochSeconds).toBe("number");
            }
            return;
          }

          const created = createResult.success;
          expect(created.provider).toBe("documenso");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          yield* Effect.gen(function* () {
            const fetched = yield* getDocumensoSignatureRequest(options, created.id).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(fetched.provider).toBe("documenso");
            expect(fetched.id).toBe(created.id);

            const listed = yield* listDocumensoSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.every((request) => request.provider === "documenso")).toBe(true);
            expect(listed.some((request) => request.id === created.id)).toBe(true);

            const cancelled = yield* Effect.result(
              cancelDocumensoSignatureRequest(options, created.id).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelled)) {
              expect(cancelled.failure.provider).toBe("documenso");
            }
          }).pipe(
            Effect.ensuring(
              deleteDocumensoSignatureRequest(options, created.id).pipe(
                Effect.provide(signatureHttpClientLive),
                Effect.orDie,
              ),
            ),
          );
        }),
      120_000,
    );
  });
}
