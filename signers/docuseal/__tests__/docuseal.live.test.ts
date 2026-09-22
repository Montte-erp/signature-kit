import { createPdfFixture } from "../../../tooling/testing/fixtures";
import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted } from "effect";
import {
  DocuSealSignatureRequest,
  providers as docuSealProviders,
  deleteDocuSealSignatureRequest,
  getDocuSealSignatureRequest,
  listDocuSealSignatureRequests,
} from "../src/index";
import type { DocuSealProviderOptions, DocuSealSubmissionProps } from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    apiKey: requiredEnv("DOCUSEAL_API_KEY"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("DOCUSEAL_BASE_URL"),
  }),
);

const secondaryEmail = (email: string): string =>
  email.includes("@") ? email.replace("@", "+signaturekit-second@") : email;

if (config === undefined) {
  describe.skip("DocuSeal live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, DOCUSEAL_API_KEY and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const options: DocuSealProviderOptions = {
    apiKey: Redacted.make(config.apiKey),
    sendSms: false,
    submittersOrder: "preserved",
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  };

  const reconcileDocuSealSignatureRequest = (request: DocuSealSubmissionProps) =>
    Effect.gen(function* () {
      const provider = yield* Provider.findProvider(DocuSealSignatureRequest);
      return yield* provider.reconcile(reconcileResourceProps("docuseal-live-request", request));
    }).pipe(Effect.provide(docuSealProviders(options)), Effect.provide(signatureHttpClientLive));

  const getById = (id: string) =>
    getDocuSealSignatureRequest(options, id).pipe(Effect.provide(signatureHttpClientLive));

  const listAll = () =>
    listDocuSealSignatureRequests(options).pipe(Effect.provide(signatureHttpClientLive));

  const deleteById = (id: string) =>
    deleteDocuSealSignatureRequest(options, id).pipe(Effect.provide(signatureHttpClientLive));

  describe("DocuSeal live API", () => {
    it.effect(
      "runs the create -> get -> list -> delete lifecycle against the sandbox",
      () =>
        Effect.gen(function* () {
          const input = {
            title: "SignatureKit live DocuSeal lifecycle",
            subject: "SignatureKit live DocuSeal lifecycle",
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
                email: config.recipientEmail,
                role: "signer",
                routingOrder: 1,
              },
              {
                name: "SignatureKit Live Recipient Two",
                email: secondaryEmail(config.recipientEmail),
                role: "signer",
                routingOrder: 2,
              },
            ],
            send: false,
          } satisfies DocuSealSubmissionProps;

          const created = yield* reconcileDocuSealSignatureRequest(input);

          expect(created.provider).toBe("docuseal");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          yield* Effect.gen(function* () {
            const fetched = yield* getById(created.id);
            expect(fetched.provider).toBe("docuseal");
            expect(fetched.id).toBe(created.id);
            expect(fetched.detailsUrl).toContain(created.id);

            const listed = yield* listAll();
            expect(listed.map((request) => request.id)).toContain(created.id);

            const deleted = yield* deleteById(created.id);
            expect(deleted).toBeUndefined();

            const deletedAgain = yield* deleteById(created.id);
            expect(deletedAgain).toBeUndefined();
          }).pipe(Effect.ensuring(deleteById(created.id).pipe(Effect.orDie)));
        }),
      120_000,
    );
  });
}
