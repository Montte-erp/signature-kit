import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result } from "effect";
import {
  DocumensoSignatureRequest,
  DocumensoSignatureRequestProvider,
  cancelDocumensoSignatureRequest,
  deleteDocumensoSignatureRequest,
  documensoCredentialsLayer,
  getDocumensoSignatureRequest,
  listDocumensoSignatureRequests,
  type DocumensoProviderOptions,
} from "../src/index";

const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const apiKey = process.env.DOCUMENSO_API_KEY;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (apiKey === undefined || recipientEmail === undefined) return undefined;

  return {
    apiKey,
    recipientEmail,
    baseUrl: process.env.DOCUMENSO_BASE_URL,
    authorizationScheme: process.env.DOCUMENSO_AUTHORIZATION_SCHEME,
  };
};

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

const documensoOptions = (
  config: NonNullable<ReturnType<typeof liveConfig>>,
): DocumensoProviderOptions => ({
  apiKey: Redacted.make(config.apiKey),
  ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  ...(config.authorizationScheme === "bearer" ? { authorizationScheme: "bearer" } : {}),
});

const reconcileDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* DocumensoSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("documenso-live-request", request));
  }).pipe(
    Effect.provide(DocumensoSignatureRequestProvider()),
    Effect.provide(documensoCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

const config = liveConfig();

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
                content: livePdf(),
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
            // Keep the envelope a draft so the lifecycle never emails a real recipient.
            send: false,
          } satisfies RemoteSignatureRequestInput;

          const createResult = yield* Effect.result(
            reconcileDocumensoSignatureRequest(options, input),
          );
          // The shared sandbox account enforces a fair-use quota. A 429 (or a 400
          // LIMIT_EXCEEDED) is an environmental cap, not a code fault — so instead of
          // failing, assert the client models the rate limit correctly: a rejected
          // request is retryable and carries the reset window for backoff.
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
            // get: the freshly created envelope resolves by its own id.
            const fetched = yield* getDocumensoSignatureRequest(options, created.id).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(fetched.provider).toBe("documenso");
            expect(fetched.id).toBe(created.id);

            // list: exercises pagination (Stream.paginate) and must surface the created id.
            const listed = yield* listDocumensoSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.every((request) => request.provider === "documenso")).toBe(true);
            expect(listed.some((request) => request.id === created.id)).toBe(true);

            // cancel: best-effort — a draft envelope may not be cancellable, so accept a typed
            // failure without turning it into an unexpected defect.
            const cancelled = yield* Effect.result(
              cancelDocumensoSignatureRequest(options, created.id).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelled)) {
              expect(cancelled.failure.provider).toBe("documenso");
            }
          }).pipe(
            // delete: idempotent cleanup (a 404 is treated as success by the provider).
            Effect.ensuring(
              deleteDocumensoSignatureRequest(options, created.id).pipe(
                Effect.provide(signatureHttpClientLive),
                Effect.ignore,
              ),
            ),
          );
        }),
      120_000,
    );
  });
}
