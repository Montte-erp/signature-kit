import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteSignatureRequestInput } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Redacted, Result } from "effect";
import { createDocuSealSignatureRequest } from "../src/index";

const textEncoder = new TextEncoder();

const pdfDocument = {
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  content: textEncoder.encode("pdf payload"),
};

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
          authToken: headerText(request.headers["x-auth-token"]),
          bodyText,
        };
        calls.push(call);

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
