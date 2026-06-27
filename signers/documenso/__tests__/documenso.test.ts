import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
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

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
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

describe("Documenso remote signatures", () => {
  it.effect("creates and distributes an envelope over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* createDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          baseUrl: `${local.baseUrl}/`,
        },
        input,
      ).pipe(Effect.provide(signatureHttpClientLive));

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
      const result = yield* createDocumensoSignatureRequest(
        {
          apiKey: Redacted.make("documenso-token"),
          authorizationScheme: "bearer",
          baseUrl: local.baseUrl,
        },
        { ...input, send: false },
      ).pipe(Effect.provide(signatureHttpClientLive));

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
        createDocumensoSignatureRequest(
          {
            apiKey: Redacted.make("documenso-token"),
            baseUrl: `${local.baseUrl}/bad`,
          },
          input,
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.provider).toBe("documenso");
      }
      yield* closeServer(local.server);
    }),
  );
});
