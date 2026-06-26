import { describe, expect, it } from "@effect/vitest";
import { SignatureHttpClient, type SignatureHttpRequest } from "@signature-kit/core/http";
import { Effect, Layer, Redacted, Result } from "effect";
import { createDropboxSignSignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const input = {
  title: "NDA",
  subject: "Please sign the NDA",
  message: "Thanks.",
  documents: [
    {
      fileName: "nda.pdf",
      mimeType: "application/pdf",
      content: textEncoder.encode("dropbox pdf"),
    },
  ],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      routingOrder: 0,
    },
  ],
  redirectUrl: "https://app.example.com/after-sign",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

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

describe("Dropbox Sign remote signatures", () => {
  it.effect("sends a test-mode signature request with uploaded files", () =>
    Effect.gen(function* () {
      const requests: SignatureHttpRequest[] = [];
      const result = yield* createDropboxSignSignatureRequest(
        {
          apiKey: Redacted.make("dropbox-secret"),
          baseUrl: "https://api.hellosign.example.test/v3/",
          testMode: true,
          clientId: "client-123",
        },
        input,
      ).pipe(
        Effect.provide(
          clientLayer(requests, [
            {
              signature_request: {
                signature_request_id: "request-1",
                details_url: "https://app.hellosign.example.test/details",
                signing_url: "https://app.hellosign.example.test/sign",
                is_complete: false,
                has_error: false,
                test_mode: true,
              },
            },
          ]),
        ),
      );

      expect(result).toEqual({
        provider: "dropbox-sign",
        id: "request-1",
        state: "sent",
        providerStatus: "test_sent",
        signingUrl: "https://app.hellosign.example.test/sign",
        detailsUrl: "https://app.hellosign.example.test/details",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://api.hellosign.example.test/v3/signature_request/send");
      expect(requests[0]?.headers).toEqual(
        expect.objectContaining({ Authorization: "Basic ZHJvcGJveC1zZWNyZXQ6" }),
      );
      if (requests[0]?.body !== undefined && typeof requests[0].body === "object") {
        expect(requests[0].body.constructor.name).toBe("FormData");
      }
    }),
  );

  it.effect("rejects draft requests because the send endpoint cannot create them", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createDropboxSignSignatureRequest(
          { apiKey: Redacted.make("dropbox-secret") },
          { ...input, send: false },
        ).pipe(Effect.provide(clientLayer([], []))),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
        expect(result.failure.provider).toBe("dropbox-sign");
      }
    }),
  );
});
