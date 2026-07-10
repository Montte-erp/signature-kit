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
                contentBase64: Buffer.from(livePdf()).toString("base64"),
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
                Effect.ignore,
              ),
            ),
          );
        }),
      120_000,
    );
  });
}
