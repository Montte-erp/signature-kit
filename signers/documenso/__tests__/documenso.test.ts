import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result } from "effect";
import {
  DocumensoSignatureRequest,
  DocumensoSignatureRequestProvider,
  cancelDocumensoSignatureRequest,
  documensoCredentialsLayer,
  type DocumensoProviderOptions,
  deleteDocumensoSignatureRequest,
  downloadDocumensoSignedDocument,
  getDocumensoSignatureRequest,
  listDocumensoSignatureRequests,
} from "../src/index";

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
type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly query: string | undefined;
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
  readonly bodyText: string;
};

type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly calls: CapturedCall[];
};
type LocalServerOptions = {
  readonly deleteNotFoundIds?: readonly string[];
};

const envelopeItemsFromId = (envelopeId: string): { id: string }[] => [
  {
    id: `doc-item-${envelopeId}`,
  },
];

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
  response.end(body);
};

const startServer = (options: LocalServerOptions = {}): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    const deleteNotFoundIds = new Set(options.deleteNotFoundIds);
    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const call = {
          method: request.method ?? "GET",
          path: url.pathname,
          query: url.search === "" ? undefined : url.search,
          contentType: headerText(request.headers["content-type"]),
          authorization: headerText(request.headers.authorization),
          bodyText,
        };
        calls.push(call);

        let body: unknown = undefined;
        if (bodyText !== "") {
          try {
            body = JSON.parse(bodyText);
          } catch {}
        }

        if (call.path === "/envelope/create") {
          writeJson(response, { id: "envelope-123" });
          return;
        }
        if (call.path === "/envelope/distribute") {
          writeJson(response, {
            success: true,
            id: "envelope-123",
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
          });
          return;
        }
        if (call.path === "/bad/envelope/create") {
          writeJson(response, {});
          return;
        }
        if (call.path === "/envelope") {
          writeJson(response, {
            data: [
              {
                id: "envelope-999",
                status: "PENDING",
                recipients: [
                  {
                    id: 1,
                    name: "Ana Silva",
                    email: "ana@example.com",
                    role: "SIGNER",
                    signingUrl: "https://documenso.example.test/sign/recipient-token",
                  },
                ],
                envelopeItems: envelopeItemsFromId("envelope-999"),
              },
            ],
            pagination: {},
          });
          return;
        }
        if (call.path === "/envelope/cancel") {
          writeJson(response, { success: true });
          return;
        }
        if (call.path === "/envelope/delete") {
          if (
            body !== null &&
            body !== undefined &&
            typeof body === "object" &&
            "envelopeId" in body &&
            typeof body.envelopeId === "string" &&
            deleteNotFoundIds.has(body.envelopeId)
          ) {
            response.statusCode = 404;
            response.end("not found");
            return;
          }
          writeJson(response, { success: true });
          return;
        }

        const envelopeDownloadMatch = call.path.match(/^\/envelope\/item\/([^/]+)\/download$/);
        if (envelopeDownloadMatch !== null) {
          writeBinary(response, textEncoder.encode("documenso signed pdf"));
          return;
        }

        const envelopeMatch = call.path.match(/^\/envelope\/([^/]+)$/);
        if (envelopeMatch !== null) {
          const envelopeId = envelopeMatch[1] ?? "envelope-123";
          writeJson(response, {
            id: envelopeId,
            status: "COMPLETED",
            recipients: [
              {
                id: 1,
                name: "Ana Silva",
                email: "ana@example.com",
                role: "SIGNER",
                signingUrl: "https://documenso.example.test/sign/recipient-token",
              },
            ],
            envelopeItems: envelopeItemsFromId(envelopeId),
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

const reconcileDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* DocumensoSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("documenso-request", request));
  }).pipe(
    Effect.provide(DocumensoSignatureRequestProvider()),
    Effect.provide(documensoCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

describe("Documenso remote signatures", () => {
  it.effect("creates and distributes an envelope over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* reconcileDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: `${local.baseUrl}/`,
        },
        input,
      );

      expect(result).toEqual({
        provider: "documenso",
        id: "envelope-123",
        state: "sent",
        providerStatus: "distributed",
        signingUrl: "https://documenso.example.test/sign/recipient-token",
        detailsUrl: `${local.baseUrl}/envelope/envelope-123`,
      });
      expect(local.calls.map((call) => call.path)).toEqual([
        "/envelope/create",
        "/envelope/distribute",
      ]);

      const createCall = local.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall.authorization).toBe("documenso-token");
        expect(createCall.contentType).toContain("multipart/form-data");
        expect(createCall.bodyText).toContain('name="payload"');
        expect(createCall.bodyText).toContain('"title":"Service Agreement"');
        expect(createCall.bodyText).toContain('"role":"APPROVER"');
        expect(createCall.bodyText).toContain('name="files"');
        expect(createCall.bodyText).toContain('filename="agreement.pdf"');
      }

      const distributeCall = local.calls[1];
      expect(distributeCall).toBeDefined();
      if (distributeCall !== undefined) {
        expect(distributeCall.authorization).toBe("documenso-token");
        expect(distributeCall.contentType).toContain("application/json");
        expect(parseBody(distributeCall)).toEqual({
          envelopeId: "envelope-123",
          meta: {
            subject: "Please sign",
            message: "Review and sign this agreement.",
            redirectUrl: "https://app.example.com/done",
          },
        });
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("keeps envelopes as draft without distribute HTTP calls", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* reconcileDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          authorizationScheme: "bearer",
          baseUrl: local.baseUrl,
        },
        { ...input, send: false },
      );

      expect(result).toEqual({
        provider: "documenso",
        id: "envelope-123",
        state: "draft",
        providerStatus: "DRAFT",
        detailsUrl: `${local.baseUrl}/envelope/envelope-123`,
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.authorization).toBe("Bearer documenso-token");
      yield* closeServer(local.server);
    }),
  );

  it.effect("fails when the create response has no envelope id", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        reconcileDocumensoSignatureRequest(
          {
            apiKey: Redacted.make("documenso-token"),
            baseUrl: `${local.baseUrl}/bad`,
          },
          input,
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.provider).toBe("documenso");
      }
      yield* closeServer(local.server);
    }),
  );
  it.effect("gets an envelope over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* getDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: local.baseUrl,
        },
        "envelope-888",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual({
        provider: "documenso",
        id: "envelope-888",
        state: "completed",
        providerStatus: "COMPLETED",
        signingUrl: "https://documenso.example.test/sign/recipient-token",
        detailsUrl: `${local.baseUrl}/envelope/envelope-888`,
        downloadUrl: `${local.baseUrl}/envelope/item/doc-item-envelope-888/download?version=signed`,
      });
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/envelope/envelope-888");
      expect(local.calls[0]?.authorization).toBe("documenso-token");
      yield* closeServer(local.server);
    }),
  );

  it.effect("lists envelopes over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* listDocumensoSignatureRequests({
        apiKey: Redacted.make("documenso-token"),
        baseUrl: local.baseUrl,
      }).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toEqual([
        {
          provider: "documenso",
          id: "envelope-999",
          state: "sent",
          providerStatus: "PENDING",
          signingUrl: "https://documenso.example.test/sign/recipient-token",
          detailsUrl: `${local.baseUrl}/envelope/envelope-999`,
          downloadUrl: `${local.baseUrl}/envelope/item/doc-item-envelope-999/download?version=signed`,
        },
      ]);
      expect(local.calls).toHaveLength(1);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/envelope");
      expect(local.calls[0]?.authorization).toBe("documenso-token");
      yield* closeServer(local.server);
    }),
  );

  it.effect("cancels envelope requests over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* cancelDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: local.baseUrl,
        },
        "envelope-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      const cancelCall = local.calls[0];
      expect(cancelCall).toBeDefined();
      if (cancelCall === undefined) return;
      expect(cancelCall.method).toBe("POST");
      expect(cancelCall.path).toBe("/envelope/cancel");
      expect(cancelCall.authorization).toBe("documenso-token");
      expect(cancelCall.contentType).toContain("application/json");
      expect(parseBody(cancelCall)).toEqual({ envelopeId: "envelope-123" });
      yield* closeServer(local.server);
    }),
  );

  it.effect("deletes envelope requests over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* deleteDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: local.baseUrl,
        },
        "envelope-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      const deleteCall = local.calls[0];
      expect(deleteCall).toBeDefined();
      if (deleteCall === undefined) return;
      expect(deleteCall.method).toBe("POST");
      expect(deleteCall.path).toBe("/envelope/delete");
      expect(deleteCall.authorization).toBe("documenso-token");
      expect(deleteCall.contentType).toContain("application/json");
      expect(parseBody(deleteCall)).toEqual({ envelopeId: "envelope-123" });
      yield* closeServer(local.server);
    }),
  );

  it.effect("treats already deleted envelopes as a no-op", () =>
    Effect.gen(function* () {
      const local = yield* startServer({ deleteNotFoundIds: ["envelope-missing"] });
      const result = yield* deleteDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: local.baseUrl,
        },
        "envelope-missing",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(result).toBeUndefined();
      expect(local.calls).toHaveLength(1);
      const deleteCall = local.calls[0];
      expect(deleteCall).toBeDefined();
      if (deleteCall === undefined) return;
      expect(deleteCall.method).toBe("POST");
      expect(deleteCall.path).toBe("/envelope/delete");
      expect(deleteCall.authorization).toBe("documenso-token");
      expect(deleteCall.contentType).toContain("application/json");
      expect(parseBody(deleteCall)).toEqual({ envelopeId: "envelope-missing" });
      yield* closeServer(local.server);
    }),
  );

  it.effect("downloads signed documents over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* downloadDocumensoSignedDocument(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: local.baseUrl,
        },
        "envelope-123",
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(new TextDecoder().decode(result)).toBe("documenso signed pdf");
      expect(local.calls).toHaveLength(2);
      expect(local.calls[0]?.method).toBe("GET");
      expect(local.calls[0]?.path).toBe("/envelope/envelope-123");
      expect(local.calls[1]?.method).toBe("GET");
      expect(local.calls[1]?.path).toBe("/envelope/item/doc-item-envelope-123/download");
      expect(local.calls[1]?.query).toBe("?version=signed");
      expect(local.calls[1]?.authorization).toBe("documenso-token");
      yield* closeServer(local.server);
    }),
  );
});
