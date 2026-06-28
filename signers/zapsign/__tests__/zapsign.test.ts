import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  SignatureKitErrorCodeValue,
  type RemoteSignatureRequestInput,
} from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import {
  cancelZapSignSignatureRequest,
  createZapSignSignatureRequest,
  deleteZapSignSignatureRequest,
  downloadZapSignSignedDocument,
  getZapSignSignatureRequest,
  listZapSignSignatureRequests,
} from "../src/index";

const textEncoder = new TextEncoder();

const pdfDocument = {
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  content: textEncoder.encode("zapsign pdf"),
};

const pdfInput = {
  title: "ZapSign request",
  message: "Assine por favor",
  documents: [pdfDocument],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      routingOrder: 4,
    },
  ],
  redirectUrl: "https://app.example.com/zapsign",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
} satisfies RemoteSignatureRequestInput;

const xmlInput = {
  title: "Wrong MIME",
  documents: [
    {
      fileName: "invoice.xml",
      mimeType: "application/xml",
      content: textEncoder.encode("<invoice />"),
    },
  ],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
    },
  ],
} satisfies RemoteSignatureRequestInput;

const signedDocumentContent = textEncoder.encode("zapsign signed document");

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
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

const writeBinary = (response: ServerResponse, bytes: Uint8Array): void => {
  response.setHeader("Connection", "close");
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.end(bytes);
};

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    let baseUrl: string | undefined;

    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const call = {
          method: request.method ?? "GET",
          path: url.pathname,
          contentType: headerText(request.headers["content-type"]),
          authorization: headerText(request.headers.authorization),
          bodyText,
        };
        calls.push(call);

        if (call.path === "/docs/" && call.method === "POST") {
          writeJson(response, {
            token: "document-token",
            status: "pending",
            original_file: "https://sandbox.zapsign.test/original.pdf",
            signed_file: null,
            signers: [
              {
                token: "signer-token",
                sign_url: "https://app.zapsign.com.br/verificar/signer-token",
                status: "new",
              },
            ],
          });
          return;
        }

        if (call.path === "/docs/document-123/" && call.method === "GET") {
          writeJson(response, {
            token: "document-123",
            status: "completed",
            original_file: `${baseUrl}/files/original.pdf`,
            signed_file: `${baseUrl}/files/signed.pdf`,
            signers: [
              {
                token: "signer-token",
                sign_url: "https://app.zapsign.com.br/verificar/signer-token",
                status: "signed",
              },
            ],
          });
          return;
        }

        if (call.path === "/docs/" && call.method === "GET") {
          if (url.searchParams.get("page") === "2") {
            writeJson(response, {
              count: 1,
              next: null,
              previous: `${baseUrl}/docs/?page=1&include_signers=true`,
              results: [
                {
                  token: "document-789",
                  status: "signed",
                  original_file: `${baseUrl}/files/original-3.pdf`,
                  signed_file: `${baseUrl}/files/signed-3.pdf`,
                  signers: [
                    {
                      token: "signer-token-3",
                      sign_url: "https://app.zapsign.com.br/verificar/signer-3",
                      status: "signed",
                    },
                  ],
                },
              ],
            });
            return;
          }

          writeJson(response, {
            count: 2,
            next: `${baseUrl}/docs/?page=2&include_signers=true`,
            previous: null,
            results: [
              {
                token: "document-123",
                status: "completed",
                original_file: `${baseUrl}/files/original-1.pdf`,
                signed_file: `${baseUrl}/files/signed-1.pdf`,
                signers: [
                  {
                    token: "signer-token-1",
                    sign_url: "https://app.zapsign.com.br/verificar/signer-1",
                    status: "signed",
                  },
                ],
              },
              {
                token: "document-456",
                status: "deleted",
                original_file: `${baseUrl}/files/original-2.pdf`,
              },
            ],
          });
          return;
        }

        if (call.path === "/refuse/" && call.method === "POST") {
          response.statusCode = 200;
          response.end();
          return;
        }

        if (call.path === "/docs/document-404/" && call.method === "DELETE") {
          response.statusCode = 404;
          response.end("not found");
          return;
        }

        if (call.path === "/docs/document-500/" && call.method === "DELETE") {
          response.statusCode = 500;
          response.end("delete failed");
          return;
        }

        if (call.path === "/docs/document-123/" && call.method === "DELETE") {
          response.statusCode = 200;
          response.end();
          return;
        }

        if (call.path === "/files/signed.pdf" && call.method === "GET") {
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
        const resolved = `http://127.0.0.1:${address.port}`;
        baseUrl = resolved;
        started.resolve({ server, baseUrl: resolved, calls });
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

describe("ZapSign remote signatures", () => {
  it.effect("creates one PDF document through the live HTTP client", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createZapSignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          apiToken: Redacted.make("zapsign-token"),
          locale: "en",
          authMode: "tokenEmail",
          disableSignerEmails: true,
        },
        pdfInput,
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "zapsign",
        id: "document-token",
        state: "sent",
        detailsUrl: "https://sandbox.zapsign.test/original.pdf",
        providerStatus: "pending",
        signingUrl: "https://app.zapsign.com.br/verificar/signer-token",
      });
      expect(local.calls).toHaveLength(1);
      const call = local.calls[0];
      expect(call).toBeDefined();
      if (call !== undefined) {
        expect(call.method).toBe("POST");
        expect(call.path).toBe("/docs/");
        expect(call.authorization).toBe("Bearer zapsign-token");
        expect(call.contentType).toContain("application/json");
        expect(parseBody(call)).toEqual({
          name: "ZapSign request",
          base64_pdf: Buffer.from(pdfDocument.content).toString("base64"),
          lang: "en",
          disable_signer_emails: true,
          signature_order_active: true,
          signers: [
            {
              name: "Ana Silva",
              email: "ana@example.com",
              auth_mode: "tokenEmail",
              send_automatic_email: false,
              order_group: 4,
              custom_message: "Assine por favor",
              redirect_link: "https://app.example.com/zapsign",
            },
          ],
          date_limit_to_sign: "2030-01-01T00:00:00.000Z",
        });
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("gets a signature request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* getZapSignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          apiToken: Redacted.make("zapsign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "zapsign",
        id: "document-123",
        state: "completed",
        providerStatus: "completed",
        signingUrl: "https://app.zapsign.com.br/verificar/signer-token",
        detailsUrl: `${local.baseUrl}/files/original.pdf`,
        downloadUrl: `${local.baseUrl}/files/signed.pdf`,
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/docs/document-123/");
      expect(local.calls[0]?.authorization).toBe("Bearer zapsign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("lists signature requests across pages", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* listZapSignSignatureRequests({
        baseUrl: local.baseUrl,
        apiToken: Redacted.make("zapsign-list-token"),
      }).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual([
        {
          provider: "zapsign",
          id: "document-123",
          state: "completed",
          providerStatus: "completed",
          signingUrl: "https://app.zapsign.com.br/verificar/signer-1",
          detailsUrl: `${local.baseUrl}/files/original-1.pdf`,
          downloadUrl: `${local.baseUrl}/files/signed-1.pdf`,
        },
        {
          provider: "zapsign",
          id: "document-456",
          state: "deleted",
          providerStatus: "deleted",
          detailsUrl: `${local.baseUrl}/files/original-2.pdf`,
        },
        {
          provider: "zapsign",
          id: "document-789",
          state: "completed",
          providerStatus: "signed",
          signingUrl: "https://app.zapsign.com.br/verificar/signer-3",
          detailsUrl: `${local.baseUrl}/files/original-3.pdf`,
          downloadUrl: `${local.baseUrl}/files/signed-3.pdf`,
        },
      ]);
      expect(local.calls).toHaveLength(2);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/docs/");
      expect(local.calls[1]?.method).toBe("GET");
      expect(local.calls[1]?.path).toBe("/docs/");
      expect(local.calls[0]?.authorization).toBe("Bearer zapsign-list-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("cancels a signature request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* cancelZapSignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          apiToken: Redacted.make("zapsign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      const cancelCall = local.calls[0];
      expect(cancelCall).toBeDefined();
      if (cancelCall === undefined) return;
      expect(cancelCall.method).toBe("POST");
      expect(cancelCall.path).toBe("/refuse/");
      expect(parseBody(cancelCall)).toEqual({
        doc_token: "document-123",
        rejected_reason: "Cancelled by SignatureKit provider lifecycle action.",
        notify_signer: false,
      });

      yield* closeServer(local.server);
    }),
  );

  it.effect("deletes a signature request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteZapSignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          apiToken: Redacted.make("zapsign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/docs/document-123/");

      yield* closeServer(local.server);
    }),
  );

  it.effect("treats missing signature request deletion as success", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        deleteZapSignSignatureRequest(
          {
            baseUrl: local.baseUrl,
            apiToken: Redacted.make("zapsign-token"),
          },
          "document-404",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isSuccess(result)).toBe(true);
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/docs/document-404/");

      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when delete returns a non-404 HTTP error", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        deleteZapSignSignatureRequest(
          {
            baseUrl: local.baseUrl,
            apiToken: Redacted.make("zapsign-token"),
          },
          "document-500",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.http);
        expect(result.failure.status).toBe(500);
      }
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/docs/document-500/");

      yield* closeServer(local.server);
    }),
  );

  it.effect("downloads a signed document", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* downloadZapSignSignedDocument(
        {
          baseUrl: local.baseUrl,
          apiToken: Redacted.make("zapsign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual(signedDocumentContent);
      expect(local.calls.map((call) => `${call.method}:${call.path}`)).toEqual([
        "GET:/docs/document-123/",
        "GET:/files/signed.pdf",
      ]);

      yield* closeServer(local.server);
    }),
  );

  it.effect("rejects non-PDF uploads before HTTP", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createZapSignSignatureRequest(
          {
            baseUrl: "http://127.0.0.1:1",
            apiToken: Redacted.make("zapsign-token"),
          },
          xmlInput,
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
        expect(result.failure.provider).toBe("zapsign");
      }
    }),
  );
});
