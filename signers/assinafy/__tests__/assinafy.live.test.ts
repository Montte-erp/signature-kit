import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted } from "effect";
import { createAssinafySignatureRequest } from "../src/index";

const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const accountId = process.env.ASSINAFY_ACCOUNT_ID;
  const apiKey = process.env.ASSINAFY_API_KEY;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (accountId === undefined || apiKey === undefined || recipientEmail === undefined) {
    return undefined;
  }

  return {
    accountId,
    apiKey,
    recipientEmail,
    baseUrl: process.env.ASSINAFY_BASE_URL,
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

const config = liveConfig();

if (config === undefined) {
  describe.skip("Assinafy live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, ASSINAFY_ACCOUNT_ID, ASSINAFY_API_KEY and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  describe("Assinafy live API", () => {
    it.effect("creates an assignment on the sandbox API with a dummy PDF", () =>
      Effect.gen(function* () {
        const input = {
          title: "SignatureKit live Assinafy assignment",
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

        const request = yield* createAssinafySignatureRequest(
          {
            accountId: config.accountId,
            apiKey: Redacted.make(config.apiKey),
            environment: "sandbox",
            ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
          },
          input,
        ).pipe(Effect.provide(signatureHttpClientLive));

        expect(request.provider).toBe("assinafy");
        expect(request.state).toBe("draft");
        expect(request.id.length).toBeGreaterThan(0);
      }),
    );
  });
}
