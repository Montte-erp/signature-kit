import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { SignatureKitSchemaNameValue } from "@signature-kit/core/config";
import { decodeRemoteOptions, signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import { AssinafyProviderOptionsSchema, createAssinafySignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const input = {
  title: "Assinafy request",
  message: "Assine por favor",
  documents: [
    {
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      content: textEncoder.encode("assinafy pdf"),
    },
  ],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      routingOrder: 1,
    },
  ],
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
} satisfies RemoteSignatureRequestInput;

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
  readonly apiKey: string | undefined;
  readonly bodyText: string;
};

type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly calls: CapturedCall[];
};

const readBody = (request: IncomingMessage): Promise<string> => {
  const done = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => done.resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", done.reject);
  return done.promise;
};

const headerText = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const writeJson = (response: ServerResponse, body: unknown): void => {
  response.setHeader("Connection", "close");
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
};

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    let signerCount = 0;

    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const call = {
          method: request.method ?? "GET",
          path: url.pathname,
          contentType: headerText(request.headers["content-type"]),
          authorization: headerText(request.headers.authorization),
          apiKey: headerText(request.headers["x-api-key"]),
          bodyText,
        };
        calls.push(call);

        if (call.path === "/v1/accounts/account-123/documents") {
          writeJson(response, {
            status: 200,
            message: "",
            data: {
              id: "document-123",
              status: "metadata_ready",
              signing_url: "https://assinafy.example.test/sign/document-123",
            },
          });
          return;
        }
        if (call.path === "/v1/accounts/account-123/signers") {
          signerCount += 1;
          writeJson(response, {
            status: 200,
            message: "",
            data: { id: `signer-${signerCount}` },
          });
          return;
        }
        if (call.path === "/v1/documents/document-123/assignments") {
          writeJson(response, {
            status: 200,
            message: "",
            data: {
              id: "assignment-123",
              signing_urls: [
                { signer_id: "signer-1", url: "https://assinafy.example.test/sign/1" },
              ],
            },
          });
          return;
        }

        response.statusCode = 404;
        response.end("not found");
      });
    });

    server.on("error", started.reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        started.resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, calls });
        return;
      }
      started.reject("HTTP server did not expose a TCP port.");
    });

    return started.promise;
  });

const closeServer = (server: Server): Effect.Effect<void> =>
  Effect.sync(() => {
    server.closeAllConnections();
    server.closeIdleConnections();
    server.close();
  });

const parseBody = (call: CapturedCall): unknown => JSON.parse(call.bodyText);

describe("Assinafy remote signatures", () => {
  it.effect("uploads the document, creates a signer, and creates an assignment", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        input,
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "assinafy",
        id: "assignment-123",
        state: "sent",
        providerStatus: "assignment_created",
        signingUrl: "https://assinafy.example.test/sign/1",
        detailsUrl: `${local.baseUrl}/v1/documents/document-123`,
      });
      expect(local.calls.map((call) => call.path)).toEqual([
        "/v1/accounts/account-123/documents",
        "/v1/accounts/account-123/signers",
        "/v1/documents/document-123/assignments",
      ]);

      const uploadCall = local.calls[0];
      expect(uploadCall).toBeDefined();
      if (uploadCall !== undefined) {
        expect(uploadCall.apiKey).toBe("assinafy-key");
        expect(uploadCall.contentType).toContain("multipart/form-data");
        expect(uploadCall.bodyText).toContain('name="file"');
        expect(uploadCall.bodyText).toContain('filename="contract.pdf"');
      }

      const signerCall = local.calls[1];
      expect(signerCall).toBeDefined();
      if (signerCall !== undefined) {
        expect(signerCall.apiKey).toBe("assinafy-key");
        expect(parseBody(signerCall)).toEqual({
          full_name: "Ana Silva",
          email: "ana@example.com",
        });
      }

      const assignmentCall = local.calls[2];
      expect(assignmentCall).toBeDefined();
      if (assignmentCall !== undefined) {
        expect(assignmentCall.apiKey).toBe("assinafy-key");
        expect(parseBody(assignmentCall)).toEqual({
          method: "virtual",
          signers: [
            {
              id: "signer-1",
              verification_method: "Email",
              notification_methods: ["Email"],
              step: 1,
            },
          ],
          message: "Assine por favor",
          expires_at: "2030-01-01T00:00:00.000Z",
        });
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("supports bearer-token credentials through the same HTTP flow", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          accessToken: Redacted.make("assinafy-access-token"),
        },
        { ...input, send: false },
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result.state).toBe("draft");
      expect(local.calls[0]?.authorization).toBe("Bearer assinafy-access-token");
      expect(local.calls[1]?.authorization).toBe("Bearer assinafy-access-token");
      expect(local.calls[2]?.authorization).toBe("Bearer assinafy-access-token");
      yield* closeServer(local.server);
    }),
  );

  it.effect("requires an API key or access token", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        decodeRemoteOptions(
          AssinafyProviderOptionsSchema,
          SignatureKitSchemaNameValue.assinafyProviderOptions,
          "assinafy",
          { baseUrl: "http://127.0.0.1:1", accountId: "account-123" },
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.INVALID_INPUT");
        expect(result.failure.provider).toBe("assinafy");
        expect(result.failure.schemaName).toBe("AssinafyProviderOptions");
      }
    }),
  );
});
