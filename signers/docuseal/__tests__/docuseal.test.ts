import { describe, expect, it } from "@effect/vitest";
import { SignatureHttpClient, type SignatureHttpRequest } from "@signature-kit/core/http";
import { Effect, Layer, Redacted, Result } from "effect";
import { createDocuSealSignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const input = {
  title: "Contract",
  subject: "Please sign",
  message: "Review and sign.",
  documents: [
    {
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      content: textEncoder.encode("pdf payload"),
    },
  ],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      routingOrder: 0,
    },
  ],
  redirectUrl: "https://app.example.com/done",
};

const clientLayer = (requests: SignatureHttpRequest[], responses: unknown[]) =>
  Layer.succeed(SignatureHttpClient, {
    requestJson: (request: SignatureHttpRequest) => {
      requests.push(request);
      const response = responses.shift();
      return Effect.succeed(response === undefined ? [] : response);
    },
    requestVoid: (request: SignatureHttpRequest) => {
      requests.push(request);
      return Effect.void;
    },
  });

describe("DocuSeal remote signatures", () => {
  it.effect("creates a one-off PDF submission", () =>
    Effect.gen(function* () {
      const requests: SignatureHttpRequest[] = [];
      const result = yield* createDocuSealSignatureRequest(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: "https://docuseal.example.test/",
          sendSms: false,
        },
        input,
      ).pipe(
        Effect.provide(
          clientLayer(requests, [
            [
              {
                submission_id: 42,
                status: "sent",
                embed_src: "https://docuseal.example.test/s/link",
              },
            ],
          ]),
        ),
      );

      expect(result).toEqual({
        provider: "docuseal",
        id: "42",
        state: "sent",
        providerStatus: "sent",
        signingUrl: "https://docuseal.example.test/s/link",
        detailsUrl: "https://docuseal.example.test/submissions/42",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://docuseal.example.test/submissions/pdf");
      expect(requests[0]?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          "X-Auth-Token": "docuseal-secret",
        }),
      );
      if (typeof requests[0]?.body === "string") {
        const body = JSON.parse(requests[0].body);
        expect(body).toMatchObject({
          name: "Contract",
          subject: "Please sign",
          send_email: true,
          send_sms: false,
          completed_redirect_url: "https://app.example.com/done",
          documents: [{ name: "contract.pdf", position: 0 }],
          submitters: [
            {
              name: "Ana Silva",
              email: "ana@example.com",
              role: "Ana Silva",
              order: 0,
              completed_redirect_url: "https://app.example.com/done",
            },
          ],
          message: { body: "Review and sign." },
        });
        expect(body.documents[0].file).toBe("cGRmIHBheWxvYWQ=");
      }
    }),
  );

  it.effect("fails when DocuSeal returns no submitter", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createDocuSealSignatureRequest({ apiKey: Redacted.make("docuseal-secret") }, input).pipe(
          Effect.provide(clientLayer([], [[]])),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.provider).toBe("docuseal");
      }
    }),
  );
});
