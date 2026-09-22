import { createPdfFixture } from "../../../tooling/testing/fixtures";
import { describe, expect, it } from "@effect/vitest";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted, Result, Schema } from "effect";
import {
  ZapSignSignatureRequest,
  ZapSignDocumentStateSchema,
  providers as zapSignProviders,
  cancelZapSignSignatureRequest,
  deleteZapSignSignatureRequest,
  downloadZapSignSignedDocument,
  getZapSignSignatureRequest,
  listZapSignSignatureRequests,
} from "../src/index";
import type { ZapSignDocumentProps, ZapSignProviderOptions } from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    apiToken: requiredEnv("ZAPSIGN_API_TOKEN"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("ZAPSIGN_BASE_URL"),
  }),
);

const reconcileZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  request: ZapSignDocumentProps,
) =>
  Effect.gen(function* () {
    const provider = yield* Provider.findProvider(ZapSignSignatureRequest);
    return yield* provider.reconcile(reconcileResourceProps("zapsign-live-request", request));
  }).pipe(Effect.provide(zapSignProviders(options)), Effect.provide(signatureHttpClientLive));

if (config === undefined) {
  describe.skip("ZapSign live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, ZAPSIGN_API_TOKEN and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const options = {
    apiToken: Redacted.make(config.apiToken),
    environment: "sandbox",
    locale: "pt-br",
    disableSignerEmails: true,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  } satisfies ZapSignProviderOptions;

  const input = {
    title: "SignatureKit live ZapSign lifecycle",
    message: "Created by SignatureKit live lifecycle test.",
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
        email: config.recipientEmail,
        routingOrder: 1,
      },
    ],
    send: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  } satisfies ZapSignDocumentProps;

  describe("ZapSign live API", () => {
    it.effect(
      "runs the full draft lifecycle against the sandbox",
      () =>
        Effect.gen(function* () {
          const created = yield* reconcileZapSignSignatureRequest(options, input);

          expect(created.provider).toBe("zapsign");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          const documentToken = created.id;

          yield* Effect.gen(function* () {
            const fetched = yield* getZapSignSignatureRequest(options, documentToken).pipe(
              Effect.provide(signatureHttpClientLive),
            );

            expect(fetched.provider).toBe("zapsign");
            expect(fetched.id).toBe(documentToken);
            yield* Schema.decodeUnknownEffect(ZapSignDocumentStateSchema)(fetched.state);
            expect(fetched.providerStatus).toBeDefined();

            const listed = yield* listZapSignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBeGreaterThan(0);
            yield* Effect.forEach(listed, (request) =>
              Effect.gen(function* () {
                expect(request.provider).toBe("zapsign");
                yield* Schema.decodeUnknownEffect(ZapSignDocumentStateSchema)(request.state);
              }),
            );

            const downloadResult = yield* Effect.result(
              downloadZapSignSignedDocument(options, documentToken).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            expect(Result.isFailure(downloadResult)).toBe(true);
            if (Result.isFailure(downloadResult)) {
              expect(downloadResult.failure.code).toBe(
                SignatureKitErrorCodeValue.unsupportedOperation,
              );
              expect(downloadResult.failure.provider).toBe("zapsign");
            }

            const cancelResult = yield* Effect.result(
              cancelZapSignSignatureRequest(options, documentToken).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelResult)) {
              expect(typeof cancelResult.failure.code).toBe("string");
            }
          }).pipe(
            Effect.ensuring(
              deleteZapSignSignatureRequest(options, documentToken).pipe(
                Effect.provide(signatureHttpClientLive),
                Effect.orDie,
              ),
            ),
          );
        }),
      60_000,
    );
  });
}
