import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result } from "effect";
import {
  DocumensoSignatureRequest,
  DocumensoSignatureRequestProvider,
  documensoCredentialsLayer,
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
  describe("Documenso live API", () => {
    it.effect("creates a draft envelope on the configured dev API", () =>
      Effect.gen(function* () {
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
              email: config.recipientEmail,
              role: "signer",
              routingOrder: 1,
            },
          ],
          send: false,
        } satisfies RemoteSignatureRequestInput;

        const result = yield* Effect.result(
          reconcileDocumensoSignatureRequest(
            {
              apiKey: Redacted.make(config.apiKey),
              ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
              ...(config.authorizationScheme === "bearer" ? { authorizationScheme: "bearer" } : {}),
            },
            input,
          ),
        );

        if (Result.isFailure(result)) {
          const reachedAccountLimit =
            result.failure.code === "signature-kit.HTTP" &&
            result.failure.status === 400 &&
            result.failure.reason?.includes("LIMIT_EXCEEDED") === true;
          expect(reachedAccountLimit, result.failure.message).toBe(true);
          return;
        }

        const request = result.success;
        expect(request.provider).toBe("documenso");
        expect(request.state).toBe("draft");
        expect(request.id.length).toBeGreaterThan(0);
      }),
    );
  });
}
