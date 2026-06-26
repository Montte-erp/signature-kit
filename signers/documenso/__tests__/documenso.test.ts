import { describe, expect, it } from "@effect/vitest";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { SignatureHttpClient, type SignatureHttpRequest } from "@signature-kit/core/http";
import { Effect, Layer, Redacted, Result } from "effect";
import { createDocumensoSignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const input = {
  title: "Service Agreement",
  subject: "Please sign",
  message: "Review and sign this agreement.",
  documents: [
    {
      fileName: "agreement.pdf",
      mimeType: "application/pdf",
      content: textEncoder.encode("documenso pdf"),
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
  redirectUrl: "https://app.example.com/done",
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

describe("Documenso remote signatures", () => {
  it.effect("creates and distributes an envelope", () =>
    Effect.gen(function* () {
      const requests: SignatureHttpRequest[] = [];
      const result = yield* createDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: "https://documenso.example.test/api/v2/",
        },
        input,
      ).pipe(
        Effect.provide(
          clientLayer(requests, [
            { id: "envelope_123" },
            {
              success: true,
              id: "envelope_123",
              recipients: [
                {
                  id: 1,
                  name: "Ana Silva",
                  email: "ana@example.com",
                  token: "recipient-token",
                  role: "APPROVER",
                  signingOrder: 1,
                  signingUrl: "https://documenso.example.test/sign/recipient-token",
                },
              ],
            },
          ]),
        ),
      );

      expect(result).toEqual({
        provider: "documenso",
        id: "envelope_123",
        state: "sent",
        providerStatus: "distributed",
        signingUrl: "https://documenso.example.test/sign/recipient-token",
        detailsUrl: "https://documenso.example.test/api/v2/envelope/envelope_123",
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]?.url).toBe("https://documenso.example.test/api/v2/envelope/create");
      expect(requests[0]?.headers).toEqual(
        expect.objectContaining({ Authorization: "documenso-token" }),
      );
      const createBody = requests[0]?.body;
      if (
        createBody !== undefined &&
        typeof createBody === "object" &&
        "get" in createBody &&
        typeof createBody.get === "function" &&
        "getAll" in createBody &&
        typeof createBody.getAll === "function"
      ) {
        const payload = createBody.get("payload");
        expect(typeof payload).toBe("string");
        if (typeof payload === "string") {
          expect(JSON.parse(payload)).toEqual({
            type: "DOCUMENT",
            title: "Service Agreement",
            recipients: [
              {
                name: "Ana Silva",
                email: "ana@example.com",
                role: "APPROVER",
                signingOrder: 1,
              },
            ],
            meta: {
              subject: "Please sign",
              message: "Review and sign this agreement.",
              redirectUrl: "https://app.example.com/done",
            },
          });
        }
        expect(createBody.getAll("files")).toHaveLength(1);
      }
      expect(requests[1]?.url).toBe("https://documenso.example.test/api/v2/envelope/distribute");
      expect(requests[1]?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "documenso-token",
        }),
      );
      expect(requests[1]?.body).toBe(
        JSON.stringify({
          envelopeId: "envelope_123",
          meta: {
            subject: "Please sign",
            message: "Review and sign this agreement.",
            redirectUrl: "https://app.example.com/done",
          },
        }),
      );
    }),
  );

  it.effect("keeps the envelope as draft when send is false", () =>
    Effect.gen(function* () {
      const requests: SignatureHttpRequest[] = [];
      const result = yield* createDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          authorizationScheme: "bearer",
        },
        { ...input, send: false },
      ).pipe(Effect.provide(clientLayer(requests, [{ id: "envelope_draft" }])));

      expect(result).toEqual({
        provider: "documenso",
        id: "envelope_draft",
        state: "draft",
        providerStatus: "DRAFT",
        detailsUrl: "https://app.documenso.com/api/v2/envelope/envelope_draft",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer documenso-token" }),
      );
    }),
  );

  it.effect("fails when the create response has no envelope id", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createDocumensoSignatureRequest({ apiKey: Redacted.make("documenso-token") }, input).pipe(
          Effect.provide(clientLayer([], [{}])),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.provider).toBe("documenso");
      }
    }),
  );
});
