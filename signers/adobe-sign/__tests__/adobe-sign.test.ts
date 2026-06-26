import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { SignatureHttpClient, type SignatureHttpRequest } from "@signature-kit/core/http";
import { Effect, Layer, Redacted } from "effect";
import { createAdobeSignSignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const input = {
  title: "Agreement",
  message: "Please sign this agreement.",
  documents: [
    {
      fileName: "agreement.pdf",
      mimeType: "application/pdf",
      content: textEncoder.encode("adobe pdf"),
    },
  ],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      role: "approver",
      routingOrder: 1,
    },
  ],
  send: false,
  redirectUrl: "https://app.example.com/signed",
} satisfies RemoteSignatureRequestInput;

const clientLayer = (requests: SignatureHttpRequest[], responses: unknown[]) =>
  Layer.succeed(SignatureHttpClient, {
    requestJson: (request: SignatureHttpRequest) => {
      requests.push(request);
      const response = responses.shift();
      return Effect.succeed(response === undefined ? {} : response);
    },
    requestVoid: (request: SignatureHttpRequest) => {
      requests.push(request);
      return Effect.void;
    },
  });

describe("Adobe Sign remote signatures", () => {
  it.effect("uploads transient documents and creates a draft agreement", () =>
    Effect.gen(function* () {
      const requests: SignatureHttpRequest[] = [];
      const result = yield* createAdobeSignSignatureRequest(
        {
          accessToken: Redacted.make("adobe-token"),
          baseUrl: "https://api.na1.echosign.example.test/",
        },
        input,
      ).pipe(
        Effect.provide(
          clientLayer(requests, [
            { transientDocumentId: "transient-1" },
            { id: "agreement-1", status: "DRAFT" },
          ]),
        ),
      );

      expect(result).toEqual({
        provider: "adobe-sign",
        id: "agreement-1",
        state: "draft",
        providerStatus: "DRAFT",
        detailsUrl: "https://api.na1.echosign.example.test/api/rest/v6/agreements/agreement-1",
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]?.url).toBe(
        "https://api.na1.echosign.example.test/api/rest/v6/transientDocuments",
      );
      expect(requests[0]?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer adobe-token" }),
      );
      expect(requests[1]?.url).toBe("https://api.na1.echosign.example.test/api/rest/v6/agreements");
      if (typeof requests[1]?.body === "string") {
        const body = JSON.parse(requests[1].body);
        expect(body).toEqual({
          fileInfos: [{ transientDocumentId: "transient-1" }],
          name: "Agreement",
          participantSetsInfo: [
            {
              memberInfos: [{ email: "ana@example.com" }],
              order: 1,
              role: "APPROVER",
            },
          ],
          signatureType: "ESIGN",
          state: "DRAFT",
          message: "Please sign this agreement.",
          postSignOption: { redirectUrl: "https://app.example.com/signed" },
        });
      }
    }),
  );
});
