import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result, Schema } from "effect";
import {
  AssinafyProviderOptionsSchema,
  AssinafySignatureRequest,
  AssinafySignatureRequestProvider,
  assinafyCredentialsLayer,
  type AssinafyProviderOptions,
  cancelAssinafySignatureRequest,
  deleteAssinafySignatureRequest,
  downloadAssinafySignedDocument,
  getAssinafySignatureRequest,
  listAssinafySignatureRequests,
} from "../src/index";

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
const signedDocumentContent = textEncoder.encode("assinafy signed document");
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

const writeBinary = (response: ServerResponse, bytes: Uint8Array): void => {
  response.setHeader("Connection", "close");
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.end(bytes);
};

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
    let baseUrl: string | undefined;

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

        const origin = baseUrl ?? "http://127.0.0.1";

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
        if (call.path === "/v1/assignments/assignment-123/cancel" && call.method === "POST") {
          response.statusCode = 200;
          response.end();
          return;
        }
        if (call.path.startsWith("/v1/assignments/") && call.method === "GET") {
          if (call.path === "/v1/assignments/assignment-123") {
            writeJson(response, {
              status: 200,
              message: "",
              data: {
                id: "assignment-123",
                status: "completed",
                signing_url: "https://assinafy.example.test/sign/1",
                document_id: "document-123",
                document_url: `${origin}/v1/documents/document-123`,
                download_url: `${origin}/v1/assignments/assignment-123/download`,
              },
            });
            return;
          }
        }
        if (call.path.startsWith("/v1/assignments/") && call.method === "DELETE") {
          if (call.path === "/v1/assignments/missing-assignment") {
            response.statusCode = 404;
            response.end("not found");
            return;
          }
          if (call.path === "/v1/assignments/delete-error") {
            response.statusCode = 500;
            response.end("internal error");
            return;
          }
          if (call.path === "/v1/assignments/assignment-123") {
            response.statusCode = 200;
            response.end();
            return;
          }
        }
        if (call.path === "/v1/assignments") {
          writeJson(response, {
            status: 200,
            message: "",
            data: [
              {
                id: "assignment-123",
                status: "completed",
                signing_url: "https://assinafy.example.test/sign/1",
                document_id: "document-123",
              },
              {
                id: "assignment-456",
                status: "draft",
                document: { id: "document-456", status: "draft" },
              },
            ],
          });
          return;
        }
        if (call.path === "/v1/assignments/assignment-123/download") {
          writeBinary(response, signedDocumentContent);
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
        const resolvedBaseUrl = `http://127.0.0.1:${address.port}`;
        baseUrl = resolvedBaseUrl;
        started.resolve({ server, baseUrl: resolvedBaseUrl, calls });
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

const reconcileAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* AssinafySignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("assinafy-request", request));
  }).pipe(
    Effect.provide(AssinafySignatureRequestProvider()),
    Effect.provide(assinafyCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

describe("Assinafy remote signatures", () => {
  it.effect("uploads the document, creates a signer, and creates an assignment", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* reconcileAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        input,
      );

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
      const result = yield* reconcileAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          accessToken: Redacted.make("assinafy-access-token"),
        },
        { ...input, send: false },
      );

      expect(result.state).toBe("draft");
      expect(local.calls[0]?.authorization).toBe("Bearer assinafy-access-token");
      expect(local.calls[1]?.authorization).toBe("Bearer assinafy-access-token");
      expect(local.calls[2]?.authorization).toBe("Bearer assinafy-access-token");
      const assignmentCall = local.calls[2];
      expect(assignmentCall).toBeDefined();
      if (assignmentCall !== undefined) {
        expect(parseBody(assignmentCall)).toMatchObject({
          signers: [{ notification_methods: [] }],
        });
      }
      yield* closeServer(local.server);
    }),
  );
  it.effect("gets an assignment and maps its lifecycle fields", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* getAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        "assignment-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "assinafy",
        id: "assignment-123",
        state: "completed",
        providerStatus: "completed",
        signingUrl: "https://assinafy.example.test/sign/1",
        detailsUrl: `${local.baseUrl}/v1/documents/document-123`,
        downloadUrl: `${local.baseUrl}/v1/assignments/assignment-123/download`,
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.path).toBe("/v1/assignments/assignment-123");
      expect(local.calls[0]?.apiKey).toBe("assinafy-key");

      yield* closeServer(local.server);
    }),
  );

  it.effect("lists assignments", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* listAssinafySignatureRequests({
        baseUrl: local.baseUrl,
        accountId: "account-123",
        accessToken: Redacted.make("assinafy-list-token"),
      }).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual([
        {
          provider: "assinafy",
          id: "assignment-123",
          state: "completed",
          providerStatus: "completed",
          signingUrl: "https://assinafy.example.test/sign/1",
          detailsUrl: `${local.baseUrl}/v1/documents/document-123`,
          downloadUrl: `${local.baseUrl}/v1/documents/document-123/download`,
        },
        {
          provider: "assinafy",
          id: "assignment-456",
          state: "draft",
          providerStatus: "draft",
          detailsUrl: `${local.baseUrl}/v1/documents/document-456`,
          downloadUrl: `${local.baseUrl}/v1/documents/document-456/download`,
        },
      ]);
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.path).toBe("/v1/assignments");
      expect(local.calls[0]?.authorization).toBe("Bearer assinafy-list-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("cancels an assignment request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* cancelAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        "assignment-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("POST");
      expect(local.calls[0]?.path).toBe("/v1/assignments/assignment-123/cancel");

      yield* closeServer(local.server);
    }),
  );

  it.effect("deletes an assignment request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        "assignment-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/v1/assignments/assignment-123");

      yield* closeServer(local.server);
    }),
  );

  it.effect("treats missing assignment deletion as success", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteAssinafySignatureRequest(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        "missing-assignment",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/v1/assignments/missing-assignment");

      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when assignment delete returns non-404 error", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        deleteAssinafySignatureRequest(
          {
            baseUrl: local.baseUrl,
            accountId: "account-123",
            apiKey: Redacted.make("assinafy-key"),
          },
          "delete-error",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(500);
        expect(result.failure.provider).toBe("assinafy");
      }
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/v1/assignments/delete-error");

      yield* closeServer(local.server);
    }),
  );

  it.effect("downloads a signed document from the assignment", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* downloadAssinafySignedDocument(
        {
          baseUrl: local.baseUrl,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        "assignment-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual(signedDocumentContent);
      expect(local.calls.map((call) => `${call.method}:${call.path}`)).toEqual([
        "GET:/v1/assignments/assignment-123",
        "GET:/v1/assignments/assignment-123/download",
      ]);
      expect(local.calls[0]?.apiKey).toBe("assinafy-key");
      expect(local.calls[1]?.apiKey).toBe("assinafy-key");

      yield* closeServer(local.server);
    }),
  );

  it.effect("requires an API key or access token in provider options", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)({
          baseUrl: "http://127.0.0.1:1",
          accountId: "account-123",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
    }),
  );
});
