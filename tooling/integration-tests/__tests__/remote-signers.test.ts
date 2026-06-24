import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createAssinafySignatureRequest } from "@signature-kit/assinafy";
import { createClicksignSignatureRequest } from "@signature-kit/clicksign";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { createDocuSignSignatureRequest } from "@signature-kit/docusign";
import { createZapSignSignatureRequest } from "@signature-kit/zapsign";
import { Effect, Redacted, Result } from "effect";

const encoder = new TextEncoder();

const document = {
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  content: encoder.encode("%PDF-1.7\nsignature-kit"),
};

const xmlDocument = {
  fileName: "invoice.xml",
  mimeType: "application/xml",
  content: encoder.encode("<invoice />"),
};

const recipient = {
  name: "Ana Silva",
  email: "ana@example.com",
};

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
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

const startProviderServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    let clicksignSignerCount = 0;
    let clicksignListCount = 0;
    let assinafySignerCount = 0;

    const server = createServer((request, response) => {
      void readBody(request).then((bodyText) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const call = {
          method: request.method ?? "GET",
          path: url.pathname,
          query: url.searchParams,
          contentType: headerText(request.headers["content-type"]),
          authorization: headerText(request.headers.authorization),
          apiKey: headerText(request.headers["x-api-key"]),
          bodyText,
        };
        calls.push(call);

        if (call.path === "/docusign/v2.1/accounts/account-123/envelopes") {
          writeJson(response, {
            envelopeId: "env-123",
            status: "sent",
            uri: "/envelopes/env-123",
          });
          return;
        }
        if (call.path === "/clicksign/documents") {
          writeJson(response, { document: { key: "click-doc-123", status: "running" } });
          return;
        }
        if (call.path === "/clicksign/signers") {
          clicksignSignerCount += 1;
          writeJson(response, { signer: { key: `signer-${clicksignSignerCount}` } });
          return;
        }
        if (call.path === "/clicksign/lists") {
          clicksignListCount += 1;
          writeJson(response, {
            list: { request_signature_key: `request-${clicksignListCount}` },
          });
          return;
        }
        if (call.path === "/clicksign/notifications") {
          writeJson(response, { ok: true });
          return;
        }
        if (call.path === "/assinafy/v1/accounts/account-123/documents") {
          writeJson(response, {
            status: 200,
            message: "",
            data: {
              id: "assinafy-doc-123",
              status: "metadata_ready",
              signing_url: "https://api.assinafy.com.br/v1/sign/assinafy-doc-123",
            },
          });
          return;
        }
        if (call.path === "/assinafy/v1/accounts/account-123/signers") {
          assinafySignerCount += 1;
          writeJson(response, {
            status: 200,
            message: "",
            data: { id: `assinafy-signer-${assinafySignerCount}` },
          });
          return;
        }
        if (call.path === "/assinafy/v1/documents/assinafy-doc-123/assignments") {
          writeJson(response, {
            status: 200,
            message: "",
            data: {
              id: "assinafy-assignment-123",
              signing_urls: [
                {
                  signer_id: "assinafy-signer-1",
                  url: "https://api.assinafy.com.br/v1/sign/assinafy-doc-123?email=ana@example.com",
                },
              ],
            },
          });
          return;
        }
        if (call.path === "/zapsign/docs/") {
          writeJson(response, {
            token: "zap-doc-123",
            status: "pending",
            signers: [
              {
                token: "zap-signer-1",
                sign_url: "https://app.zapsign.com.br/verificar/zap-signer-1",
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

describe("remote signature signers", () => {
  it.effect("creates provider-side signature requests over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startProviderServer();

      const docuSignResult = yield* createDocuSignSignatureRequest(
        {
          baseUrl: `${local.baseUrl}/docusign`,
          accountId: "account-123",
          accessToken: Redacted.make("docusign-token"),
        },
        {
          title: "Contract",
          message: "Please sign",
          documents: [document],
          recipients: [recipient],
        },
      ).pipe(Effect.provide(signatureHttpClientLive));

      const clicksignResult = yield* createClicksignSignatureRequest(
        {
          baseUrl: `${local.baseUrl}/clicksign`,
          accessToken: Redacted.make("clicksign-token"),
          locale: "pt-BR",
        },
        {
          title: "Clicksign request",
          message: "Assine por favor",
          documents: [document],
          recipients: [recipient],
          redirectUrl: "https://example.com/done",
        },
      ).pipe(Effect.provide(signatureHttpClientLive));

      const assinafyResult = yield* createAssinafySignatureRequest(
        {
          baseUrl: `${local.baseUrl}/assinafy`,
          accountId: "account-123",
          apiKey: Redacted.make("assinafy-key"),
        },
        {
          title: "Assinafy request",
          message: "Assine por favor",
          documents: [document],
          recipients: [recipient],
        },
      ).pipe(Effect.provide(signatureHttpClientLive));

      const zapSignResult = yield* createZapSignSignatureRequest(
        {
          baseUrl: `${local.baseUrl}/zapsign`,
          apiToken: Redacted.make("zapsign-token"),
        },
        {
          title: "ZapSign request",
          message: "Assine por favor",
          documents: [document],
          recipients: [recipient],
        },
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(docuSignResult).toEqual({
        provider: "docusign",
        id: "env-123",
        state: "sent",
        providerStatus: "sent",
        detailsUrl: "/envelopes/env-123",
      });
      expect(clicksignResult).toEqual({
        provider: "clicksign",
        id: "click-doc-123",
        state: "sent",
      });
      expect(assinafyResult).toEqual({
        provider: "assinafy",
        id: "assinafy-assignment-123",
        state: "sent",
        providerStatus: "assignment_created",
        signingUrl: "https://api.assinafy.com.br/v1/sign/assinafy-doc-123?email=ana@example.com",
        detailsUrl: `${local.baseUrl}/assinafy/v1/documents/assinafy-doc-123`,
      });
      expect(zapSignResult).toEqual({
        provider: "zapsign",
        id: "zap-doc-123",
        state: "sent",
        providerStatus: "pending",
        signingUrl: "https://app.zapsign.com.br/verificar/zap-signer-1",
      });

      const docuSignCall = local.calls.find(
        (call) => call.path === "/docusign/v2.1/accounts/account-123/envelopes",
      );
      expect(docuSignCall).toBeDefined();
      if (docuSignCall === undefined) return yield* Effect.die("missing DocuSign call");
      expect(docuSignCall.authorization).toBe("Bearer docusign-token");
      expect(parseBody(docuSignCall)).toMatchObject({
        emailSubject: "Contract",
        emailBlurb: "Please sign",
        documents: [{ documentId: "1", fileExtension: "pdf", name: "contract.pdf" }],
        recipients: {
          signers: [{ email: "ana@example.com", name: "Ana Silva", recipientId: "1" }],
        },
        status: "sent",
      });

      const clicksignDocumentCall = local.calls.find(
        (call) => call.path === "/clicksign/documents",
      );
      expect(clicksignDocumentCall).toBeDefined();
      if (clicksignDocumentCall === undefined) return yield* Effect.die("missing Clicksign call");
      expect(clicksignDocumentCall.query.get("access_token")).toBe("clicksign-token");
      expect(parseBody(clicksignDocumentCall)).toMatchObject({
        document: {
          path: "/contract.pdf",
          auto_close: true,
          locale: "pt-BR",
          sequence_enabled: false,
        },
      });

      const clicksignNotifyCall = local.calls.find(
        (call) => call.path === "/clicksign/notifications",
      );
      expect(clicksignNotifyCall).toBeDefined();
      if (clicksignNotifyCall === undefined) return yield* Effect.die("missing notification call");
      expect(parseBody(clicksignNotifyCall)).toMatchObject({
        request_signature_key: "request-1",
        message: "Assine por favor",
        url: "https://example.com/done",
      });

      const assinafyUploadCall = local.calls.find(
        (call) => call.path === "/assinafy/v1/accounts/account-123/documents",
      );
      expect(assinafyUploadCall).toBeDefined();
      if (assinafyUploadCall === undefined) return yield* Effect.die("missing Assinafy upload");
      expect(assinafyUploadCall.apiKey).toBe("assinafy-key");
      expect(assinafyUploadCall.contentType).toContain("multipart/form-data");
      expect(assinafyUploadCall.bodyText).toContain('filename="contract.pdf"');

      const assinafyAssignmentCall = local.calls.find(
        (call) => call.path === "/assinafy/v1/documents/assinafy-doc-123/assignments",
      );
      expect(assinafyAssignmentCall).toBeDefined();
      if (assinafyAssignmentCall === undefined)
        return yield* Effect.die("missing Assinafy assignment");
      expect(parseBody(assinafyAssignmentCall)).toMatchObject({
        method: "virtual",
        message: "Assine por favor",
        signers: [
          {
            id: "assinafy-signer-1",
            verification_method: "Email",
            notification_methods: ["Email"],
            step: 1,
          },
        ],
      });

      const zapSignCall = local.calls.find((call) => call.path === "/zapsign/docs/");
      expect(zapSignCall).toBeDefined();
      if (zapSignCall === undefined) return yield* Effect.die("missing ZapSign document");
      expect(zapSignCall.authorization).toBe("Bearer zapsign-token");
      expect(parseBody(zapSignCall)).toMatchObject({
        name: "ZapSign request",
        lang: "pt-br",
        disable_signer_emails: false,
        signature_order_active: false,
        base64_pdf: Buffer.from(document.content).toString("base64"),
        signers: [
          {
            name: "Ana Silva",
            email: "ana@example.com",
            auth_mode: "assinaturaTela",
            send_automatic_email: true,
            order_group: 1,
            custom_message: "Assine por favor",
          },
        ],
      });

      yield* closeServer(local.server);
    }),
  );

  it.effect("keeps unsupported remote operations in the typed error channel", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createClicksignSignatureRequest(
          {
            baseUrl: "http://127.0.0.1:1/clicksign",
            accessToken: Redacted.make("clicksign-token"),
          },
          {
            title: "Too many documents",
            documents: [document, xmlDocument],
            recipients: [recipient],
          },
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
        expect(result.failure.provider).toBe("clicksign");
      }
    }),
  );

  it.effect("rejects non-PDF ZapSign uploads before HTTP", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createZapSignSignatureRequest(
          {
            baseUrl: "http://127.0.0.1:1/zapsign",
            apiToken: Redacted.make("zapsign-token"),
          },
          {
            title: "Wrong MIME",
            documents: [xmlDocument],
            recipients: [recipient],
          },
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.UNSUPPORTED_OPERATION");
        expect(result.failure.provider).toBe("zapsign");
      }
    }),
  );

  it.effect("requires an Assinafy API key or access token", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createAssinafySignatureRequest(
          { baseUrl: "http://127.0.0.1:1/assinafy", accountId: "account-123" },
          {
            title: "Missing credential",
            documents: [document],
            recipients: [recipient],
          },
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.INVALID_INPUT");
        expect(result.failure.reason).toBe("Assinafy requires either apiKey or accessToken.");
      }
    }),
  );
});
