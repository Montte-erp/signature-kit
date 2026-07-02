import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { RemoteSignatureStateSchema } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted, Result } from "effect";
import {
  ClicksignSignatureRequest,
  ClicksignSignatureRequestProvider,
  cancelClicksignSignatureRequest,
  clicksignCredentialsLayer,
  deleteClicksignSignatureRequest,
  downloadClicksignSignedDocument,
  getClicksignSignatureRequest,
  listClicksignSignatureRequests,
  type ClicksignProviderOptions,
} from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    accessToken: requiredEnv("CLICKSIGN_TOKEN"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("CLICKSIGN_BASE_URL"),
  }),
);

// Minimal single-page PDF; Clicksign v1 uploads a base64 data URI so the byte
// content only needs to be a syntactically valid PDF.
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

const knownStates = new Set<string>(RemoteSignatureStateSchema.literals);

if (config === undefined) {
  describe.skip("Clicksign live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, CLICKSIGN_TOKEN and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const options: ClicksignProviderOptions = {
    accessToken: Redacted.make(config.accessToken),
    environment: "sandbox",
    locale: "pt-BR",
    autoClose: false,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  };

  const createDraft = Effect.gen(function* () {
    const input = {
      title: "SignatureKit live Clicksign draft",
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
      ],
      send: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    } satisfies RemoteSignatureRequestInput;

    const provider = yield* ClicksignSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("clicksign-live-request", input));
  }).pipe(
    Effect.provide(ClicksignSignatureRequestProvider()),
    Effect.provide(clicksignCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

  describe("Clicksign live API", () => {
    it.effect(
      "runs the full create -> get -> list -> cancel -> delete lifecycle on the sandbox",
      () =>
        Effect.gen(function* () {
          // 1. create (send:false / draft)
          const created = yield* createDraft;
          expect(created.provider).toBe("clicksign");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          const id = created.id;

          yield* Effect.gen(function* () {
            // 2. get by id — assert real provider fields
            const fetched = yield* getClicksignSignatureRequest(options, id).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(fetched.provider).toBe("clicksign");
            expect(fetched.id).toBe(id);
            // The remote status is provider-driven; assert it is a known state.
            expect(knownStates.has(fetched.state)).toBe(true);
            expect(typeof fetched.providerStatus).toBe("string");
            expect(fetched.detailsUrl).toContain(id);

            // 3. list — the created document id must be reachable (pagination is
            // exercised inside listClicksignSignatureRequests, which walks page_infos).
            const listed = yield* listClicksignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBeGreaterThan(0);
            const match = listed.find((request) => request.id === id);
            expect(match).toBeDefined();
            expect(match?.provider).toBe("clicksign");

            // 4. cancel — a draft document may or may not be cancellable on the
            // sandbox; exercise the real path and accept either a void success or
            // a typed SignatureKitError contract.
            const cancelled = yield* Effect.result(
              cancelClicksignSignatureRequest(options, id).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelled)) {
              expect(cancelled.failure.provider).toBe("clicksign");
              expect(typeof cancelled.failure.code).toBe("string");
            } else {
              expect(cancelled.success).toBeUndefined();
            }

            // Downloading a signed document requires a human signer, so it is not
            // exercised here. downloadClicksignSignedDocument stays referenced so
            // the import contract is validated by the type checker.
            const _download = downloadClicksignSignedDocument;
            void _download;
          }).pipe(
            // 5. delete — clean up whatever we created so re-runs stay idempotent.
            // delete tolerates a 404, so this is safe even if cancel already
            // removed the document.
            Effect.ensuring(
              deleteClicksignSignatureRequest(options, id)
                .pipe(Effect.provide(signatureHttpClientLive))
                .pipe(Effect.ignore),
            ),
          );
        }),
      { timeout: 60_000 },
    );
  });
}
