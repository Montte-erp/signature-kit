import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import {
  closeLocalServer,
  parseBodyAsJson,
  startLocalServer,
  type LocalRequest,
  type LocalResponse,
} from "../../__tests__/local-http";
import { Effect, Redacted, Result } from "effect";
import {
  ZapSignSignatureRequest,
  type ZapSignDocumentProps,
  type ZapSignProviderOptions,
  ZapSignSignatureRequestProvider,
  downloadZapSignSignedDocument,
  deleteZapSignSignatureRequest,
  getZapSignSignatureRequest,
  listZapSignSignatureRequests,
  zapSignCredentialsLayer,
} from "../src/index";

const base64Pdf = Buffer.from(
  "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n",
).toString("base64");

const reconcileInput = (): ZapSignDocumentProps => ({
  title: "ZapSign local reconciliation",
  message: "Created by local offline test",
  documents: [
    {
      fileName: "signature-kit-offline.pdf",
      mimeType: "application/pdf",
      contentBase64: base64Pdf,
    },
  ],
  recipients: [
    {
      name: "Local Signer",
      email: "signer@example.test",
      routingOrder: 2,
    },
  ],
  send: false,
  expiresAt: new Date("2024-01-01T00:00:00.000Z"),
  redirectUrl: "https://example.test/local-callback",
});

const reconcileZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  request: ZapSignDocumentProps,
) =>
  Effect.gen(function* () {
    const provider = yield* ZapSignSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileResourceProps("zapsign-local-request", request));
  }).pipe(
    Effect.provide(ZapSignSignatureRequestProvider()),
    Effect.provide(zapSignCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

describe("ZapSign local API", () => {
  it.effect("reconciles via POST /docs with the expected auth header and JSON body", () =>
    Effect.gen(function* () {
      const local = yield* startLocalServer(
        async (request: LocalRequest): Promise<LocalResponse> => {
          if (request.method === "POST" && request.pathname === "/docs/") {
            return {
              status: 200,
              body: JSON.stringify({
                token: "local-create-doc",
                status: "draft",
              }),
            };
          }

          return { status: 404, body: "not found" };
        },
      );

      const options = {
        apiToken: Redacted.make("zapsign-local-token"),
        baseUrl: local.baseUrl,
        locale: "en",
      } satisfies ZapSignProviderOptions;

      const request = yield* reconcileZapSignSignatureRequest(options, reconcileInput());

      expect(request.provider).toBe("zapsign");
      expect(request.id).toBe("local-create-doc");
      expect(request.state).toBe("draft");

      const createCall = local.requests[0];
      expect(createCall).toBeDefined();
      if (createCall === undefined) {
        return;
      }
      expect(createCall.method).toBe("POST");
      expect(createCall.pathname).toBe("/docs/");
      expect(createCall.headers.authorization).toBe("Bearer zapsign-local-token");
      expect(createCall.headers["content-type"]).toBe("application/json");

      const createBody = parseBodyAsJson<{
        name: string;
        base64_pdf: string;
        lang: string;
        disable_signer_emails: boolean;
        signature_order_active: boolean;
        signers: Array<{
          name: string;
          email: string;
          auth_mode: string;
          send_automatic_email: boolean;
          order_group: number;
          custom_message?: string;
          redirect_link?: string;
        }>;
        date_limit_to_sign?: string;
      }>(createCall.body);

      expect(createBody.name).toBe("ZapSign local reconciliation");
      expect(createBody.base64_pdf).toBe(base64Pdf);
      expect(createBody.lang).toBe("en");
      expect(createBody.disable_signer_emails).toBe(true);
      expect(createBody.signature_order_active).toBe(true);
      expect(createBody.signers).toEqual([
        {
          name: "Local Signer",
          email: "signer@example.test",
          auth_mode: "assinaturaTela",
          send_automatic_email: false,
          order_group: 2,
          custom_message: "Created by local offline test",
          redirect_link: "https://example.test/local-callback",
        },
      ]);
      expect(createBody.date_limit_to_sign).toBe("2024-01-01T00:00:00.000Z");

      yield* closeLocalServer(local.server);
    }),
  );

  it.effect("maps every local state from get payload status", () =>
    Effect.gen(function* () {
      type LocalRequestState =
        | "draft"
        | "sent"
        | "completed"
        | "cancelled"
        | "declined"
        | "deleted"
        | "expired";
      type ExpectedStateFixture = {
        readonly id: string;
        readonly remoteStatus:
          | "draft"
          | "signed"
          | "cancelled"
          | "refused"
          | "deleted"
          | "expired"
          | undefined;
        readonly expected: LocalRequestState;
      };

      const expectedStates: readonly ExpectedStateFixture[] = [
        { id: "doc-draft", remoteStatus: "draft", expected: "draft" },
        { id: "doc-sent", remoteStatus: undefined, expected: "sent" },
        { id: "doc-completed", remoteStatus: "signed", expected: "completed" },
        { id: "doc-cancelled", remoteStatus: "cancelled", expected: "cancelled" },
        { id: "doc-declined", remoteStatus: "refused", expected: "declined" },
        { id: "doc-deleted", remoteStatus: "deleted", expected: "deleted" },
        { id: "doc-expired", remoteStatus: "expired", expected: "expired" },
      ];

      const local = yield* startLocalServer(
        async (request: LocalRequest): Promise<LocalResponse> => {
          if (
            request.method === "GET" &&
            request.pathname.startsWith("/docs/") &&
            request.pathname.endsWith("/")
          ) {
            const id = request.pathname.slice(6, -1);
            const match = expectedStates.find((entry) => entry.id === id);
            if (match === undefined) return { status: 404, body: "not found" };
            const payload =
              match.remoteStatus === undefined
                ? { token: id }
                : { token: id, status: match.remoteStatus };
            return { status: 200, body: JSON.stringify(payload) };
          }

          return { status: 404, body: "not found" };
        },
      );

      const options = {
        apiToken: Redacted.make("zapsign-local-token"),
        baseUrl: local.baseUrl,
      } satisfies ZapSignProviderOptions;

      for (const entry of expectedStates) {
        const request = yield* getZapSignSignatureRequest(options, entry.id).pipe(
          Effect.provide(signatureHttpClientLive),
        );

        expect(request.id).toBe(entry.id);
        expect(request.state).toBe(entry.expected);
      }

      for (const request of local.requests) {
        expect(request.method).toBe("GET");
        expect(request.headers.authorization).toBe("Bearer zapsign-local-token");
        expect(request.pathname.startsWith("/docs/")).toBe(true);
        expect(request.pathname.endsWith("/")).toBe(true);
      }

      yield* closeLocalServer(local.server);
    }),
  );

  it.effect("lists across two pages and maps states from all local literals", () =>
    Effect.gen(function* () {
      type LocalRequestState =
        | "draft"
        | "sent"
        | "completed"
        | "cancelled"
        | "declined"
        | "deleted"
        | "expired";
      type LocalPageFixture = {
        readonly id: string;
        readonly status:
          | "draft"
          | "completed"
          | "canceled"
          | "declined"
          | "deleted"
          | "expired"
          | "signed"
          | undefined;
        readonly expected: LocalRequestState;
      };

      const pageOne: readonly LocalPageFixture[] = [
        { id: "doc-draft", status: "draft", expected: "draft" },
        { id: "doc-sent", status: undefined, expected: "sent" },
        { id: "doc-completed", status: "completed", expected: "completed" },
      ];
      const pageTwo: readonly LocalPageFixture[] = [
        { id: "doc-cancelled", status: "canceled", expected: "cancelled" },
        { id: "doc-declined", status: "declined", expected: "declined" },
        { id: "doc-deleted", status: "deleted", expected: "deleted" },
        { id: "doc-expired", status: "expired", expected: "expired" },
      ];

      const expectedStates: Readonly<Record<string, LocalRequestState>> = {
        "doc-draft": "draft",
        "doc-sent": "sent",
        "doc-completed": "completed",
        "doc-cancelled": "cancelled",
        "doc-declined": "declined",
        "doc-deleted": "deleted",
        "doc-expired": "expired",
      };

      let baseUrl = "";
      const local = yield* startLocalServer(
        async (request: LocalRequest): Promise<LocalResponse> => {
          if (request.method === "GET" && request.pathname === "/docs/") {
            const page = request.query.get("page") ?? "1";
            if (page === "1") {
              return {
                status: 200,
                body: JSON.stringify({
                  count: pageOne.length + pageTwo.length,
                  next: `${baseUrl}/docs/?page=2&include_signers=true`,
                  previous: null,
                  results: pageOne.map((entry) =>
                    entry.status === undefined
                      ? { token: entry.id }
                      : { token: entry.id, status: entry.status },
                  ),
                }),
              };
            }

            if (page === "2") {
              return {
                status: 200,
                body: JSON.stringify({
                  count: pageOne.length + pageTwo.length,
                  next: null,
                  previous: `${baseUrl}/docs/?page=1&include_signers=true`,
                  results: pageTwo.map((entry) => ({ token: entry.id, status: entry.status })),
                }),
              };
            }
          }

          return { status: 404, body: "not found" };
        },
      );
      baseUrl = local.baseUrl;

      const options = {
        apiToken: Redacted.make("zapsign-local-token"),
        baseUrl: local.baseUrl,
      } satisfies ZapSignProviderOptions;

      const listed = yield* listZapSignSignatureRequests(options).pipe(
        Effect.provide(signatureHttpClientLive),
      );

      expect(listed.length).toBe(7);
      for (const request of listed) {
        const expected = expectedStates[request.id];
        expect(expected).toBeDefined();
        if (expected === undefined) {
          return;
        }
        expect(request.state).toBe(expected);
      }

      const listRequests = local.requests.filter(
        (request) => request.method === "GET" && request.pathname === "/docs/",
      );
      expect(listRequests.length).toBe(2);
      const firstListRequest = listRequests[0];
      const secondListRequest = listRequests[1];
      expect(firstListRequest).toBeDefined();
      expect(secondListRequest).toBeDefined();
      if (firstListRequest === undefined || secondListRequest === undefined) {
        return;
      }
      expect(firstListRequest.query.get("page")).toBe("1");
      expect(firstListRequest.query.get("include_signers")).toBe("true");
      expect(secondListRequest.query.get("page")).toBe("2");
      expect(secondListRequest.query.get("include_signers")).toBe("true");

      yield* closeLocalServer(local.server);
    }),
  );

  it.effect("downloads signed bytes via downloadUrl when available", () =>
    Effect.gen(function* () {
      const expected = new TextEncoder().encode("offline signed payload");
      const local = yield* startLocalServer(
        async (request: LocalRequest): Promise<LocalResponse> => {
          if (request.method === "GET" && request.pathname === "/docs/download-doc/") {
            return {
              status: 200,
              body: JSON.stringify({
                token: "download-doc",
                status: "completed",
                signed_file: `${local.baseUrl}/files/signed.bin`,
              }),
            };
          }

          if (request.method === "GET" && request.pathname === "/files/signed.bin") {
            return {
              status: 200,
              headers: {
                "content-type": "application/pdf",
              },
              body: expected,
            };
          }

          return { status: 404, body: "not found" };
        },
      );

      const options = {
        apiToken: Redacted.make("zapsign-local-token"),
        baseUrl: local.baseUrl,
      } satisfies ZapSignProviderOptions;

      const downloaded = yield* downloadZapSignSignedDocument(options, "download-doc").pipe(
        Effect.provide(signatureHttpClientLive),
      );

      expect(Array.from(downloaded)).toEqual(Array.from(expected));
      expect(local.requests.map((request) => request.pathname)).toEqual([
        "/docs/download-doc/",
        "/files/signed.bin",
      ]);
      const firstDownloadRequest = local.requests[0];
      const secondDownloadRequest = local.requests[1];
      expect(firstDownloadRequest).toBeDefined();
      expect(secondDownloadRequest).toBeDefined();
      if (firstDownloadRequest === undefined || secondDownloadRequest === undefined) {
        return;
      }
      expect(firstDownloadRequest.method).toBe("GET");
      expect(firstDownloadRequest.headers.authorization).toBe("Bearer zapsign-local-token");
      expect(secondDownloadRequest.method).toBe("GET");

      yield* closeLocalServer(local.server);
    }),
  );

  it.effect("treats DELETE /docs/:id/ 404 as success", () =>
    Effect.gen(function* () {
      const local = yield* startLocalServer(
        async (request: LocalRequest): Promise<LocalResponse> => {
          if (request.method === "DELETE" && request.pathname === "/docs/deleted-doc/") {
            return { status: 404, body: "gone" };
          }

          return { status: 200, body: JSON.stringify({ ok: true }) };
        },
      );

      const options = {
        apiToken: Redacted.make("zapsign-local-token"),
        baseUrl: local.baseUrl,
      } satisfies ZapSignProviderOptions;

      const result = yield* Effect.result(
        deleteZapSignSignatureRequest(options, "deleted-doc").pipe(
          Effect.provide(signatureHttpClientLive),
        ),
      );
      expect(Result.isFailure(result)).toBe(false);
      if (Result.isFailure(result)) {
        return;
      }
      expect(result.success).toBeUndefined();

      const deleteRequest = local.requests[0];
      expect(deleteRequest).toBeDefined();
      if (deleteRequest === undefined) {
        return;
      }
      expect(deleteRequest.method).toBe("DELETE");
      expect(deleteRequest.pathname).toBe("/docs/deleted-doc/");
      expect(deleteRequest.headers.authorization).toBe("Bearer zapsign-local-token");

      yield* closeLocalServer(local.server);
    }),
  );
});
