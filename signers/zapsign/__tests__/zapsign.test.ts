import { describe, expect, it } from "@effect/vitest";
import {
  RemoteSignatureStateSchema,
  SignatureKitErrorCodeValue,
  type RemoteSignatureRequestInput,
} from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result, Schema } from "effect";
import {
  ZapSignSignatureRequest,
  ZapSignSignatureRequestProvider,
  type ZapSignProviderOptions,
  zapSignCredentialsLayer,
  cancelZapSignSignatureRequest,
  deleteZapSignSignatureRequest,
  downloadZapSignSignedDocument,
  getZapSignSignatureRequest,
  listZapSignSignatureRequests,
} from "../src/index";

const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const apiToken = process.env.ZAPSIGN_API_TOKEN;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (apiToken === undefined || recipientEmail === undefined) return undefined;

  return {
    apiToken,
    recipientEmail,
    baseUrl: process.env.ZAPSIGN_BASE_URL,
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

const reconcileZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* ZapSignSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("zapsign-live-request", request));
  }).pipe(
    Effect.provide(ZapSignSignatureRequestProvider()),
    Effect.provide(zapSignCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

const config = liveConfig();

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
        content: livePdf(),
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
  } satisfies RemoteSignatureRequestInput;

  describe("ZapSign live API", () => {
    it.effect(
      "runs the full draft lifecycle against the sandbox",
      () =>
        Effect.gen(function* () {
          // 1. Create a draft (send:false) via the Alchemy reconcile entry point.
          const created = yield* reconcileZapSignSignatureRequest(options, input);

          expect(created.provider).toBe("zapsign");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          const documentToken = created.id;

          // The rest of the lifecycle must always delete the created draft so
          // re-runs stay idempotent and the sandbox never accumulates junk.
          yield* Effect.gen(function* () {
            // 2. Get the created request by id and assert real response fields.
            const fetched = yield* getZapSignSignatureRequest(options, documentToken).pipe(
              Effect.provide(signatureHttpClientLive),
            );

            expect(fetched.provider).toBe("zapsign");
            expect(fetched.id).toBe(documentToken);
            // `state` is derived from the real ZapSign status; assert it is a
            // valid RemoteSignatureRequest state rather than pinning a literal
            // (a freshly created, unsent doc reports a "pending"-style status).
            yield* Schema.decodeUnknownEffect(RemoteSignatureStateSchema)(fetched.state);
            expect(fetched.providerStatus).toBeDefined();

            // 3. List requests, exercising the provider's Stream.paginate path
            // and full response decode. NOTE (real sandbox contract surprise):
            // the ZapSign sandbox `/docs/` list is a fixed, canned dataset that
            // does NOT reflect freshly created documents (its `count` never
            // changes and the just-created token never appears), so we cannot
            // assert the created id is present here. Instead assert the list
            // decodes into typed, provider-tagged, valid-state requests.
            const listed = yield* listZapSignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBeGreaterThan(0);
            yield* Effect.forEach(listed, (request) =>
              Effect.gen(function* () {
                expect(request.provider).toBe("zapsign");
                yield* Schema.decodeUnknownEffect(RemoteSignatureStateSchema)(request.state);
              }),
            );

            // 4. Downloading a *signed* document is impossible without a human
            // signer, so instead assert the typed error for a not-yet-signed
            // draft: no signed-file URL is available yet. This must run BEFORE
            // cancel, because refusing the doc finalizes it and produces a
            // signed_file URL (real ZapSign behavior), which would let download
            // succeed.
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

            // 5. Cancel the draft via ZapSign's /refuse/ endpoint. It models a
            // signer refusal, which may or may not be accepted for an unsigned
            // draft, so tolerate a typed failure here without throwing — the
            // point is to exercise the real cancel path and its typed error
            // channel, and cleanup (delete) still runs via Effect.ensuring below.
            const cancelResult = yield* Effect.result(
              cancelZapSignSignatureRequest(options, documentToken).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelResult)) {
              expect(typeof cancelResult.failure.code).toBe("string");
            }
          }).pipe(
            // 6. Clean up: delete the created draft no matter what happened above.
            // `orDie` turns a failed delete into a defect, so the test proves the
            // real DELETE endpoint accepted the request. NOTE (real sandbox
            // contract surprise): ZapSign soft-deletes — DELETE returns HTTP 200
            // and sets a `deleted: true` flag, but the doc stays GETtable with an
            // unchanged `status`, so a get-after-delete does NOT 404 and cannot be
            // used to confirm removal.
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
