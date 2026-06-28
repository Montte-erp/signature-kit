import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import {
  cancelClicksignSignatureRequest,
  createClicksignSignatureRequest,
  deleteClicksignSignatureRequest,
  downloadClicksignSignedDocument,
  getClicksignSignatureRequest,
  listClicksignSignatureRequests,
} from "../src/index";

const textEncoder = new TextEncoder();

const pdfDocument = {
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  content: textEncoder.encode("clicksign pdf"),
};

const signedDocumentContent = textEncoder.encode("clicksign signed pdf");

const input = {
  title: "Clicksign request",
  message: "Assine por favor",
  documents: [pdfDocument],
  recipients: [
    {
      name: "Ana Silva",
      email: "ana@example.com",
      role: "approver",
      routingOrder: 3,
    },
  ],
  redirectUrl: "https://app.example.com/signed",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
} satisfies RemoteSignatureRequestInput;

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly contentType: string | undefined;
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
    let signerCount = 0;
    let listCount = 0;

    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const method = request.method ?? "GET";
        const call = {
          method,
          path: url.pathname,
          query: url.searchParams,
          contentType: headerText(request.headers["content-type"]),
          bodyText,
        };
        calls.push(call);

        if (call.path === "/documents" && method === "POST") {
          writeJson(response, { document: { key: "document-123", status: "running" } });
          return;
        }
        if (call.path === "/documents" && method === "GET") {
          writeJson(response, {
            documents: [
              {
                key: "document-123",
                status: "completed",
                download_url: "/documents/document-123/download",
              },
              { key: "document-456", status: "running" },
              { key: "document-789", status: "deleted" },
            ],
          });
          return;
        }
        if (call.path === "/signers" && method === "POST") {
          signerCount += 1;
          writeJson(response, { signer: { key: `signer-${signerCount}` } });
          return;
        }
        if (call.path === "/lists" && method === "POST") {
          listCount += 1;
          writeJson(response, { list: { request_signature_key: `request-${listCount}` } });
          return;
        }
        if (call.path === "/notifications" && method === "POST") {
          writeJson(response, { ok: true });
          return;
        }
        if (call.path.endsWith("/cancel") && method === "POST") {
          response.statusCode = 200;
          response.end();
          return;
        }
        if (call.path.endsWith("/download") && method === "GET") {
          writeBinary(response, signedDocumentContent);
          return;
        }
        if (call.path.startsWith("/documents/") && method === "DELETE") {
          if (call.path === "/documents/missing-document") {
            response.statusCode = 404;
            response.end("not found");
            return;
          }
          if (call.path === "/documents/delete-error") {
            response.statusCode = 500;
            response.end("internal error");
            return;
          }
          response.statusCode = 200;
          response.end();
          return;
        }

        if (call.path.startsWith("/documents/") && method === "GET") {
          const [, , id] = call.path.split("/");
          writeJson(response, {
            document: {
              key: id ?? "document-123",
              status: "signed",
              download_url: `/documents/${id ?? "document-123"}/download`,
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

describe("Clicksign remote signatures", () => {
  it.effect("creates document, signer, list, and notification through the live HTTP client", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createClicksignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
          locale: "pt-BR",
          autoClose: false,
        },
        input,
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "clicksign",
        id: "document-123",
        state: "sent",
      });
      expect(local.calls.map((call) => call.path)).toEqual([
        "/documents",
        "/signers",
        "/lists",
        "/notifications",
      ]);
      expect(
        local.calls.every((call) => call.query.get("access_token") === "clicksign-token"),
      ).toBe(true);

      const documentCall = local.calls[0];
      expect(documentCall).toBeDefined();
      if (documentCall !== undefined) {
        expect(documentCall.contentType).toContain("application/json");
        expect(parseBody(documentCall)).toMatchObject({
          document: {
            path: "/contract.pdf",
            content_base64: `data:application/pdf;base64,${Buffer.from(pdfDocument.content).toString("base64")}`,
            deadline_at: "2030-01-01T00:00:00.000Z",
            auto_close: false,
            locale: "pt-BR",
            sequence_enabled: true,
          },
        });
      }

      const signerCall = local.calls[1];
      expect(signerCall).toBeDefined();
      if (signerCall !== undefined) {
        expect(parseBody(signerCall)).toEqual({
          signer: {
            email: "ana@example.com",
            name: "Ana Silva",
            auths: ["email"],
            has_documentation: false,
          },
        });
      }

      const listCall = local.calls[2];
      expect(listCall).toBeDefined();
      if (listCall !== undefined) {
        expect(parseBody(listCall)).toEqual({
          list: {
            document_key: "document-123",
            signer_key: "signer-1",
            sign_as: "approve",
            group: 3,
            message: "Assine por favor",
          },
        });
      }

      const notificationCall = local.calls[3];
      expect(notificationCall).toBeDefined();
      if (notificationCall !== undefined) {
        expect(parseBody(notificationCall)).toEqual({
          request_signature_key: "request-1",
          message: "Assine por favor",
          url: "https://app.example.com/signed",
        });
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("gets a clicksign request and maps lifecycle status", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* getClicksignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "clicksign",
        id: "document-123",
        state: "completed",
        providerStatus: "signed",
        detailsUrl: `${local.baseUrl}/documents/document-123`,
        downloadUrl: "/documents/document-123/download",
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/documents/document-123");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("lists clicksign requests and maps lifecycle states", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* listClicksignSignatureRequests({
        baseUrl: local.baseUrl,
        accessToken: Redacted.make("clicksign-list-token"),
      }).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual([
        {
          provider: "clicksign",
          id: "document-123",
          state: "completed",
          providerStatus: "completed",
          detailsUrl: `${local.baseUrl}/documents/document-123`,
          downloadUrl: "/documents/document-123/download",
        },
        {
          provider: "clicksign",
          id: "document-456",
          state: "sent",
          providerStatus: "running",
          detailsUrl: `${local.baseUrl}/documents/document-456`,
          downloadUrl: `${local.baseUrl}/documents/document-456/download`,
        },
        {
          provider: "clicksign",
          id: "document-789",
          state: "deleted",
          providerStatus: "deleted",
          detailsUrl: `${local.baseUrl}/documents/document-789`,
          downloadUrl: `${local.baseUrl}/documents/document-789/download`,
        },
      ]);
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/documents");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-list-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("cancels a clicksign request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* cancelClicksignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("POST");
      expect(local.calls[0]?.path).toBe("/documents/document-123/cancel");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("deletes a clicksign request", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteClicksignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/documents/document-123");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("treats missing clicksign request as deleted", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteClicksignSignatureRequest(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
        },
        "missing-document",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/documents/missing-document");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when clicksign delete returns non-404 error", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        deleteClicksignSignatureRequest(
          {
            baseUrl: local.baseUrl,
            accessToken: Redacted.make("clicksign-token"),
          },
          "delete-error",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(500);
        expect(result.failure.provider).toBe("clicksign");
      }
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("DELETE");
      expect(local.calls[0]?.path).toBe("/documents/delete-error");
      expect(local.calls[0]?.query.get("access_token")).toBe("clicksign-token");

      yield* closeServer(local.server);
    }),
  );

  it.effect("downloads a signed clicksign document", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* downloadClicksignSignedDocument(
        {
          baseUrl: local.baseUrl,
          accessToken: Redacted.make("clicksign-token"),
        },
        "document-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual(signedDocumentContent);
      expect(local.calls.map((call) => `${call.method}:${call.path}`)).toEqual([
        "GET:/documents/document-123",
        "GET:/documents/document-123/download",
      ]);
      expect(
        local.calls.every((call) => call.query.get("access_token") === "clicksign-token"),
      ).toBe(true);

      yield* closeServer(local.server);
    }),
  );

  it.effect("redacts query-string access tokens from typed HTTP errors", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        createClicksignSignatureRequest(
          {
            baseUrl: `${local.baseUrl}/missing`,
            accessToken: Redacted.make("clicksign-secret"),
          },
          input,
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.reason).toContain("access_token=%3Credacted%3E");
        expect(result.failure.reason).not.toContain("clicksign-secret");
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("redacts query-string access tokens from lifecycle requests", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        getClicksignSignatureRequest(
          {
            baseUrl: `${local.baseUrl}/missing`,
            accessToken: Redacted.make("clicksign-lifecycle-secret"),
          },
          "document-123",
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.reason).toContain("access_token=%3Credacted%3E");
        expect(result.failure.reason).not.toContain("clicksign-lifecycle-secret");
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("rejects multiple uploaded documents before HTTP", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createClicksignSignatureRequest(
          {
            baseUrl: "http://127.0.0.1:1",
            accessToken: Redacted.make("clicksign-token"),
          },
          { ...input, documents: [pdfDocument, pdfDocument] },
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
        expect(result.failure.provider).toBe("clicksign");
      }
    }),
  );
});
