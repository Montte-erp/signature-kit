import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted } from "effect";
import { createClicksignSignatureRequest } from "../src/index";

const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const accessToken = process.env.CLICKSIGN_TOKEN;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (accessToken === undefined || recipientEmail === undefined) return undefined;

  return {
    accessToken,
    recipientEmail,
    baseUrl: process.env.CLICKSIGN_BASE_URL,
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
  describe.skip("Clicksign live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, CLICKSIGN_TOKEN and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  describe("Clicksign live API", () => {
    it.effect("creates a draft document on the sandbox API", () =>
      Effect.gen(function* () {
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

        const request = yield* createClicksignSignatureRequest(
          {
            accessToken: Redacted.make(config.accessToken),
            environment: "sandbox",
            locale: "pt-BR",
            autoClose: false,
            ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
          },
          input,
        ).pipe(Effect.provide(signatureHttpClientLive));

        expect(request.provider).toBe("clicksign");
        expect(request.state).toBe("draft");
        expect(request.id.length).toBeGreaterThan(0);
      }),
    );
  });
}
