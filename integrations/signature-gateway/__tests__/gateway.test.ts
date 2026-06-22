import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { Effect, Redacted, Result } from "effect";
import {
  SignatureProviderErrorCodeValue,
  createFetchHttpClient,
  createSignatureGateway,
} from "@signature-kit/signature-gateway";
import { adobeSign } from "@signature-kit/adobe-sign";
import { clicksign } from "@signature-kit/clicksign";
import { docusign } from "@signature-kit/docusign";
import { dropboxSign } from "@signature-kit/dropbox-sign";

type CapturedCall = {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
  readonly bodyText: string;
};

type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly calls: CapturedCall[];
};

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

const readBody = (request: IncomingMessage): Promise<string> => {
  const done = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => done.resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", done.reject);
  return done.promise;
};

const writeJson = (response: ServerResponse, body: unknown): void => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
};

const startProviderServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const calls: CapturedCall[] = [];
    let adobeUploadCount = 0;
    let clicksignSignerCount = 0;
    let clicksignListCount = 0;

    const server = createServer((request, response) => {
      void readBody(request)
        .then((bodyText) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          const call = {
            method: request.method ?? "GET",
            path: url.pathname,
            query: url.searchParams,
            contentType: request.headers["content-type"],
            authorization: request.headers.authorization,
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
          if (call.path === "/dropbox/signature_request/send") {
            writeJson(response, {
              signature_request: {
                signature_request_id: "dropbox-123",
                is_complete: false,
                details_url: "https://app.hellosign.com/home/manage?guid=dropbox-123",
              },
            });
            return;
          }
          if (call.path === "/adobe/transientDocuments") {
            adobeUploadCount += 1;
            writeJson(response, { transientDocumentId: `transient-${adobeUploadCount}` });
            return;
          }
          if (call.path === "/adobe/agreements") {
            writeJson(response, { id: "agreement-123" });
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

          response.statusCode = 404;
          response.end("not found");
        })
        .catch((cause: unknown) => {
          response.statusCode = 500;
          response.end(String(cause));
        });
    });

    server.on("error", started.reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        started.resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, calls });
        return;
      }
      started.reject(new Error("HTTP server did not expose a TCP port."));
    });

    return started.promise;
  });

const closeServer = (server: Server): Effect.Effect<void> =>
  Effect.promise(() => {
    const closed = Promise.withResolvers<void>();
    server.close((cause) => {
      if (cause === undefined) {
        closed.resolve();
        return;
      }
      closed.reject(cause);
    });
    return closed.promise;
  });

const parseBody = (call: CapturedCall): unknown => JSON.parse(call.bodyText);

const findCall = (calls: readonly CapturedCall[], path: string): CapturedCall => {
  const call = calls.find((candidate) => candidate.path === path);
  if (call !== undefined) return call;
  throw new Error(`Missing call to ${path}.`);
};

describe("signature provider adapters", () => {
  it.effect("creates provider-side signature requests over HTTP", () =>
    Effect.gen(function* () {
      const local = yield* startProviderServer();
      const http = createFetchHttpClient();

      const gateways = createSignatureGateway({
        http,
        providers: [
          docusign({
            baseUrl: `${local.baseUrl}/docusign`,
            accountId: "account-123",
            accessToken: Redacted.make("docusign-token"),
          }),
          dropboxSign({
            baseUrl: `${local.baseUrl}/dropbox`,
            apiKey: Redacted.make("dropbox-key"),
            testMode: true,
          }),
          adobeSign({
            baseUrl: `${local.baseUrl}/adobe`,
            accessToken: Redacted.make("adobe-token"),
          }),
          clicksign({
            baseUrl: `${local.baseUrl}/clicksign`,
            accessToken: Redacted.make("clicksign-token"),
            locale: "pt-BR",
          }),
        ],
      });

      const docuSignResult = yield* gateways.createSignatureRequest({
        provider: "docusign",
        title: "Contract",
        message: "Please sign",
        documents: [document],
        recipients: [recipient],
      });
      const dropboxResult = yield* gateways.createSignatureRequest({
        provider: "dropbox-sign",
        title: "Contract",
        documents: [document],
        recipients: [recipient],
      });
      const adobeResult = yield* gateways.createSignatureRequest({
        provider: "adobe-sign",
        title: "Envelope",
        documents: [document, xmlDocument],
        recipients: [recipient],
        send: false,
      });
      const clicksignResult = yield* gateways.createSignatureRequest({
        provider: "clicksign",
        title: "Clicksign request",
        message: "Assine por favor",
        documents: [document],
        recipients: [recipient],
        redirectUrl: "https://example.com/done",
      });

      expect(docuSignResult).toEqual({
        provider: "docusign",
        id: "env-123",
        state: "sent",
        providerStatus: "sent",
        detailsUrl: "/envelopes/env-123",
      });
      expect(dropboxResult).toEqual({
        provider: "dropbox-sign",
        id: "dropbox-123",
        state: "sent",
        providerStatus: "sent",
        signingUrl: undefined,
        detailsUrl: "https://app.hellosign.com/home/manage?guid=dropbox-123",
      });
      expect(adobeResult).toEqual({ provider: "adobe-sign", id: "agreement-123", state: "draft" });
      expect(clicksignResult).toEqual({
        provider: "clicksign",
        id: "click-doc-123",
        state: "sent",
      });

      const docuSignCall = findCall(local.calls, "/docusign/v2.1/accounts/account-123/envelopes");
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

      const dropboxCall = findCall(local.calls, "/dropbox/signature_request/send");
      expect(dropboxCall.authorization).toBe("Basic ZHJvcGJveC1rZXk6");
      expect(dropboxCall.contentType).toContain("multipart/form-data");
      expect(dropboxCall.bodyText).toContain('name="signers[0][email_address]"');
      expect(dropboxCall.bodyText).toContain("ana@example.com");
      expect(dropboxCall.bodyText).toContain('filename="contract.pdf"');

      expect(local.calls.filter((call) => call.path === "/adobe/transientDocuments")).toHaveLength(
        2,
      );
      const adobeAgreementCall = findCall(local.calls, "/adobe/agreements");
      expect(adobeAgreementCall.authorization).toBe("Bearer adobe-token");
      expect(parseBody(adobeAgreementCall)).toMatchObject({
        fileInfos: [{ transientDocumentId: "transient-1" }, { transientDocumentId: "transient-2" }],
        name: "Envelope",
        participantSetsInfo: [
          { memberInfos: [{ email: "ana@example.com" }], order: 1, role: "SIGNER" },
        ],
        signatureType: "ESIGN",
        state: "DRAFT",
      });

      const clicksignDocumentCall = findCall(local.calls, "/clicksign/documents");
      expect(clicksignDocumentCall.query.get("access_token")).toBe("clicksign-token");
      expect(parseBody(clicksignDocumentCall)).toMatchObject({
        document: {
          path: "/contract.pdf",
          auto_close: true,
          locale: "pt-BR",
          sequence_enabled: false,
        },
      });
      const clicksignNotifyCall = findCall(local.calls, "/clicksign/notifications");
      expect(parseBody(clicksignNotifyCall)).toMatchObject({
        request_signature_key: "request-1",
        message: "Assine por favor",
        url: "https://example.com/done",
      });

      yield* closeServer(local.server);
    }),
  );

  it.effect("keeps unsupported provider operations in the typed error channel", () =>
    Effect.gen(function* () {
      const gateways = createSignatureGateway({
        http: createFetchHttpClient(),
        providers: [dropboxSign({ apiKey: Redacted.make("dropbox-key"), testMode: true })],
      });

      const result = yield* Effect.result(
        gateways.createSignatureRequest({
          provider: "dropbox-sign",
          title: "Draft",
          documents: [document],
          recipients: [recipient],
          send: false,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureProviderErrorCodeValue.unsupportedOperation);
      }
    }),
  );
});
