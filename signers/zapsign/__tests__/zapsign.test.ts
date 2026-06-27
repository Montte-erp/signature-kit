import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import { createZapSignSignatureRequest } from "../src/index";

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

        if (call.path === "/docs/") {
          writeJson(response, {
            token: "document-token",
            status: "pending",
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
