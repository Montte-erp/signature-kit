import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted } from "effect";
import {
  DocuSealSignatureRequest,
  DocuSealSignatureRequestProvider,
  docuSealCredentialsLayer,
  deleteDocuSealSignatureRequest,
  getDocuSealSignatureRequest,
  listDocuSealSignatureRequests,
  type DocuSealProviderOptions,
} from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    apiKey: requiredEnv("DOCUSEAL_API_KEY"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("DOCUSEAL_BASE_URL"),
  }),
);

const livePdf = (): Uint8Array => {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = encoder.encode(pdf).byteLength;
    pdf += object;
    return offset;
  });
  const xrefOffset = encoder.encode(pdf).byteLength;
  const entries = offsets
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  return encoder.encode(
    `${pdf}xref\n0 5\n0000000000 65535 f \n${entries}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
};

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

  const reconcileDocuSealSignatureRequest = (request: RemoteSignatureRequestInput) =>
    Effect.gen(function* () {
      const provider = yield* DocuSealSignatureRequest.Provider;
      return yield* provider.reconcile(reconcileInput("docuseal-live-request", request));
    }).pipe(
      Effect.provide(DocuSealSignatureRequestProvider()),
      Effect.provide(docuSealCredentialsLayer(options)),
      Effect.provide(signatureHttpClientLive),
    );

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
          // Two recipients sharing the same role exercise the submitter-role
          // dedup fix: DocuSeal rejects duplicate roles inside one submission, so
          // a successful create proves the provider disambiguated them.
          const input = {
            title: "SignatureKit live DocuSeal lifecycle",
            subject: "SignatureKit live DocuSeal lifecycle",
            message: "Created by SignatureKit live test.",
            documents: [
              {
                fileName: "signature-kit-live.pdf",
                mimeType: "application/pdf",
                content: livePdf(),
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
          } satisfies RemoteSignatureRequestInput;

          const created = yield* reconcileDocuSealSignatureRequest(input);

          expect(created.provider).toBe("docuseal");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          // Everything after the create must clean up the sandbox submission,
          // even if an assertion fails mid-way.
          yield* Effect.gen(function* () {
            const fetched = yield* getById(created.id);
            expect(fetched.provider).toBe("docuseal");
            expect(fetched.id).toBe(created.id);
            expect(fetched.detailsUrl).toContain(created.id);

            // Paginates internally (limit=100 + after cursor); assert our
            // freshly created submission is present in the listing.
            const listed = yield* listAll();
            expect(listed.map((request) => request.id)).toContain(created.id);

            // downloadDocuSealSignedDocument is intentionally not exercised: a
            // completed/signed artifact requires a human signer, and the sandbox
            // returns the unsigned source document for a draft, so there is no
            // meaningful "signed document" assertion to make here.

            // Explicit delete is the asserted cleanup step; it returns void and
            // treats a missing remote as success.
            const deleted = yield* deleteById(created.id);
            expect(deleted).toBeUndefined();

            // Idempotent: deleting again still succeeds.
            const deletedAgain = yield* deleteById(created.id);
            expect(deletedAgain).toBeUndefined();
          }).pipe(Effect.ensuring(deleteById(created.id).pipe(Effect.ignore)));
        }),
      120_000,
    );
  });
}
