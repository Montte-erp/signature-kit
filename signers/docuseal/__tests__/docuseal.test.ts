import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import {
  cancelDocuSealSignatureRequest,
  createDocuSealSignatureRequest,
  deleteDocuSealSignatureRequest,
  downloadDocuSealSignedDocument,
  getDocuSealSignatureRequest,
  listDocuSealSignatureRequests,
} from "../src/index";

const textEncoder = new TextEncoder();

const pdfDocument = {
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  content: textEncoder.encode("pdf payload"),
};

const signedDocumentContent = textEncoder.encode("docuseal signed payload");

const input = {
  title: "Contract",
  subject: "Please sign",
  message: "Review and sign.",
  documents: [pdfDocument],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      routingOrder: 0,
    },
  ],
  redirectUrl: "https://app.example.com/done",
} satisfies RemoteSignatureRequestInput;

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | undefined;
  readonly authToken: string | undefined;
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

const writeBinary = (response: ServerResponse, body: Uint8Array): void => {
  response.setHeader("Connection", "close");
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.end(Buffer.from(body));
};

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const method = request.method ?? "GET";
        const call = {
          method,
          path: url.pathname,
          contentType: headerText(request.headers["content-type"]),
          authToken: headerText(request.headers["x-auth-token"]),
          bodyText,
        };
        calls.push(call);
        const requestBaseUrl = `http://${request.headers.host ?? ""}`;

        if (call.path === "/submissions/pdf") {
          writeJson(response, {
            id: 42,
            status: "pending",
            submitters: [
              {
                submission_id: 42,
                status: "awaiting",
                embed_src: "https://docuseal.example.test/s/link",
              },
            ],
          });
          return;
        }
        if (call.path === "/empty/submissions/pdf") {
          writeJson(response, []);
          return;
        }
        if (call.path === "/submissions" && method === "GET") {
          writeJson(response, {
            data: [
              {
                id: 101,
                status: "draft",
                submitters: [
                  { submission_id: 101, sign_url: "https://docuseal.example.test/s/list-101" },
                ],
                documents: [{ download_url: `${requestBaseUrl}/documents/101/download` }],
              },
              {
                id: "102",
                status: "completed",
                submitters: [
                  { submission_id: "102", embed_src: "https://docuseal.example.test/s/list-102" },
                ],
                combined_document_url: `${requestBaseUrl}/documents/102/combined`,
              },
            ],
          });
          return;
        }
        if (call.path.startsWith("/submissions/")) {
          const [, , submissionId, nested] = call.path.split("/");
          if (submissionId === undefined) {
            response.statusCode = 404;
            response.end("not found");
            return;
          }

          if (method === "GET" && nested === "documents") {
            writeJson(response, {
              documents: [
                {
                  url: `${requestBaseUrl}/documents/${submissionId}/download`,
                  download_url: `${requestBaseUrl}/documents/${submissionId}/download`,
                },
              ],
            });
            return;
          }
          if (method === "GET") {
            if (submissionId === "42") {
              writeJson(response, {
                id: 42,
                status: "completed",
                submitters: [
                  {
                    submission_id: 42,
                    status: "completed",
                    embed_src: "https://docuseal.example.test/s/get-42",
                  },
                ],
                combined_document_url: `${requestBaseUrl}/documents/42/combined`,
              });
              return;
            }
            writeJson(response, {
              id: Number(submissionId),
              status: "pending",
              submitters: [
                {
                  submission_id: Number(submissionId),
                  status: "pending",
                  sign_url: "https://docuseal.example.test/s/get",
                },
              ],
            });
            return;
          }
          if (method === "DELETE") {
            if (call.path === "/submissions/missing-submission") {
              response.statusCode = 404;
              response.end("not found");
              return;
            }
            if (call.path === "/submissions/delete-error") {
              response.statusCode = 500;
              response.end("internal error");
              return;
            }
            response.statusCode = 200;
            response.end();
            return;
          }
        }
        if (call.path.startsWith("/documents/") && method === "GET") {
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

describe("DocuSeal remote signatures", () => {
  it.effect("creates a one-off PDF submission over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createDocuSealSignatureRequest(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: local.baseUrl,
          sendSms: false,
        },
        input,
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "docuseal",
        id: "42",
        state: "sent",
        providerStatus: "pending",
        signingUrl: "https://docuseal.example.test/s/link",
        detailsUrl: `${local.baseUrl}/submissions/42`,
      });
      expect(local.calls).toHaveLength(1);
      const call = local.calls[0];
      expect(call).toBeDefined();
      if (call !== undefined) {
        expect(call.method).toBe("POST");
        expect(call.path).toBe("/submissions/pdf");
        expect(call.authToken).toBe("docuseal-secret");
        expect(call.contentType).toContain("application/json");
        expect(parseBody(call)).toEqual({
          name: "Contract",
          send_email: true,
          order: "preserved",
          documents: [
            {
              name: "contract.pdf",
              file: Buffer.from(pdfDocument.content).toString("base64"),
              position: 0,
            },
          ],
          submitters: [
            {
              name: "Ana Silva",
              email: "ana@example.com",
              role: "Ana Silva",
              order: 0,
              completed_redirect_url: "https://app.example.com/done",
            },
          ],
          send_sms: false,
          completed_redirect_url: "https://app.example.com/done",
          subject: "Please sign",
          message: { body: "Review and sign." },
        });
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("gets a docuseal request and maps lifecycle fields", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* getDocuSealSignatureRequest(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: local.baseUrl,
        },
        "42",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "docuseal",
        id: "42",
        state: "completed",
        providerStatus: "completed",
        signingUrl: "https://docuseal.example.test/s/get-42",
        detailsUrl: `${local.baseUrl}/submissions/42`,
        downloadUrl: `${local.baseUrl}/documents/42/combined`,
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/submissions/42");
      expect(local.calls[0]?.authToken).toBe("docuseal-secret");

      yield* closeServer(local.server);
    }),
  );

  it.effect("lists docuseal requests and maps lifecycle states", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* listDocuSealSignatureRequests({
        apiKey: Redacted.make("docuseal-secret"),
        baseUrl: local.baseUrl,
      }).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual([
        {
          provider: "docuseal",
          id: "101",
          state: "draft",
          providerStatus: "draft",
          signingUrl: "https://docuseal.example.test/s/list-101",
          detailsUrl: `${local.baseUrl}/submissions/101`,
          downloadUrl: `${local.baseUrl}/documents/101/download`,
        },
        {
          provider: "docuseal",
          id: "102",
          state: "completed",
          providerStatus: "completed",
          signingUrl: "https://docuseal.example.test/s/list-102",
          detailsUrl: `${local.baseUrl}/submissions/102`,
          downloadUrl: `${local.baseUrl}/documents/102/combined`,
        },
      ]);
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/submissions");

      yield* closeServer(local.server);
    }),
  );

  it.effect(
    "returns unsupported operation for cancel because DocuSeal does not support cancel",
    () =>
      Effect.gen(function* () {
        const local = yield* startServer();
        const result = yield* Effect.result(
          cancelDocuSealSignatureRequest(
            {
              apiKey: Redacted.make("docuseal-secret"),
              baseUrl: local.baseUrl,
            },
            "42",
          ).pipe(Effect.provide(signatureHttpClientLive)),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
          expect(result.failure.provider).toBe("docuseal");
          expect(result.failure.operation).toBe("remote.cancel");
        }
        expect(local.calls).toHaveLength(0);

        yield* closeServer(local.server);
      }),
  );

  it.effect("deletes a docuseal request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteDocuSealSignatureRequest(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: local.baseUrl,
        },
        "43",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/submissions/43");

      yield* closeServer(local.server);
    }),
  );

  it.effect("treats missing docuseal request as deleted", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteDocuSealSignatureRequest(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: local.baseUrl,
        },
        "missing-submission",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/submissions/missing-submission");

      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when docuseal delete returns non-404 error", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        deleteDocuSealSignatureRequest(
          {
            apiKey: Redacted.make("docuseal-secret"),
            baseUrl: local.baseUrl,
          },
          "delete-error",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(500);
        expect(result.failure.provider).toBe("docuseal");
      }
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/submissions/delete-error");

      yield* closeServer(local.server);
    }),
  );

  it.effect("downloads a signed docuseal document", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* downloadDocuSealSignedDocument(
        {
          apiKey: Redacted.make("docuseal-secret"),
          baseUrl: local.baseUrl,
        },
        "43",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual(signedDocumentContent);
      expect(local.calls).toHaveLength(3);
      expect(local.calls.map((call) => `${call.method}:${call.path}`)).toEqual([
        "GET:/submissions/43",
        "GET:/submissions/43/documents",
        "GET:/documents/43/download",
      ]);

      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when DocuSeal returns no submitter", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        createDocuSealSignatureRequest(
          { apiKey: Redacted.make("docuseal-secret"), baseUrl: `${local.baseUrl}/empty` },
          input,
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.provider).toBe("docuseal");
      }
      yield* closeServer(local.server);
    }),
  );
});
