import { describe, expect, it } from "@effect/vitest";
import { SignatureKitErrorCodeValue, type SignatureKitError } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import {
  closeLocalServer,
  parseBodyAsJson,
  startLocalServer,
  type LocalRequest,
  type LocalResponse,
  type LocalServer,
} from "../../__tests__/local-http";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result } from "effect";
import {
  type ClicksignProviderOptions,
  ClicksignSignatureRequest,
  ClicksignSignatureRequestProvider,
  ClicksignSignatureRequestStateSchema,
  clicksignCredentialsLayer,
  deleteClicksignSignatureRequest,
  downloadClicksignSignedDocument,
  getClicksignSignatureRequest,
  listClicksignSignatureRequests,
  type ClicksignSignatureRequestAttributes,
  type ClicksignSignatureRequestProps,
} from "../src/index";

const ACCESS_TOKEN = "clicksign-local-token";
const LOCAL_DOCUMENT_BASE64 = Buffer.from("clicksign local test payload").toString("base64");

const defaultInput = (): ClicksignSignatureRequestProps => ({
  title: "SignatureKit clicksign offline",
  message: "Created by Clicksign local test.",
  documents: [
    {
      fileName: "signature-kit-offline.pdf",
      mimeType: "application/pdf",
      contentBase64: LOCAL_DOCUMENT_BASE64,
    },
  ],
  recipients: [
    {
      name: "Offline Recipient",
      email: "recipient@example.org",
      role: "signer",
    },
  ],
  send: false,
});

const clicksignOptions = (baseUrl: string): ClicksignProviderOptions => ({
  accessToken: Redacted.make(ACCESS_TOKEN),
  locale: "en-US",
  baseUrl,
});

const reconcileClicksign = (
  input: ClicksignSignatureRequestProps,
  server: LocalServer,
): Effect.Effect<ClicksignSignatureRequestAttributes, SignatureKitError, never> => {
  const options = clicksignOptions(server.baseUrl);
  return Effect.gen(function* () {
    const provider = yield* ClicksignSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileResourceProps("clicksign-local", input));
  }).pipe(
    Effect.provide(ClicksignSignatureRequestProvider()),
    Effect.provide(clicksignCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );
};

const withLocalServer = <A, E, R>(
  handler: (request: LocalRequest) => Promise<LocalResponse>,
  run: (server: LocalServer) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const server = yield* startLocalServer(handler);
    try {
      return yield* run(server);
    } finally {
      yield* closeLocalServer(server.server);
    }
  });

describe("Clicksign local HTTP provider tests", () => {
  it.effect("reconciles create requests with expected path/method/query token/body", () =>
    withLocalServer(
      (request) => {
        if (request.method === "POST" && request.pathname === "/documents") {
          const body = parseBodyAsJson<{
            document: {
              path: string;
              content_base64: string;
              locale: string;
              auto_close: boolean;
            };
          }>(request.body);
          expect(body.document.path).toBe("/signature-kit-offline.pdf");
          expect(body.document.content_base64).toBe(
            `data:application/pdf;base64,${LOCAL_DOCUMENT_BASE64}`,
          );
          expect(body.document.locale).toBe("en-US");
          expect(body.document.auto_close).toBe(true);
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ document: { key: "doc-create-1", status: "draft" } }),
          });
        }

        if (request.method === "POST" && request.pathname === "/signers") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ signer: { key: "signer-1" } }),
          });
        }

        if (request.method === "POST" && request.pathname === "/lists") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ list: { request_signature_key: "request-1" } }),
          });
        }

        return Promise.resolve({ status: 404, body: "not implemented" });
      },
      (server) =>
        Effect.gen(function* () {
          const created = yield* reconcileClicksign(defaultInput(), server);
          expect(created.id).toBe("doc-create-1");
          expect(created.state).toBe("draft");

          const createRequest = server.requests.find(
            (value) => value.method === "POST" && value.pathname === "/documents",
          );
          expect(createRequest).toBeDefined();
          expect(createRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
          expect(createRequest?.method).toBe("POST");
          expect(createRequest?.pathname).toBe("/documents");

          const signerRequest = server.requests.find(
            (value) => value.method === "POST" && value.pathname === "/signers",
          );
          expect(signerRequest).toBeDefined();
          expect(signerRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
          expect(signerRequest?.method).toBe("POST");
          expect(signerRequest?.pathname).toBe("/signers");
          const signerBody = parseBodyAsJson<{
            signer: { name: string; email: string; auths: string[]; has_documentation: boolean };
          }>(signerRequest?.body ?? "{}");
          expect(signerBody).toEqual({
            signer: {
              name: "Offline Recipient",
              email: "recipient@example.org",
              auths: ["email"],
              has_documentation: false,
            },
          });

          const listRequest = server.requests.find(
            (value) => value.method === "POST" && value.pathname === "/lists",
          );
          expect(listRequest).toBeDefined();
          expect(listRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
          expect(listRequest?.method).toBe("POST");
          expect(listRequest?.pathname).toBe("/lists");
          const listBody = parseBodyAsJson<{
            list: {
              document_key: string;
              signer_key: string;
              sign_as: string;
              group: number;
              message: string;
            };
          }>(listRequest?.body ?? "{}");
          expect(listBody).toEqual({
            list: {
              document_key: "doc-create-1",
              signer_key: "signer-1",
              sign_as: "sign",
              group: 1,
              message: "Created by Clicksign local test.",
            },
          });

          const notificationRequests = server.requests.filter(
            (value) => value.method === "POST" && value.pathname === "/notifications",
          );
          expect(notificationRequests).toHaveLength(0);
        }),
    ),
  );

  for (const state of ClicksignSignatureRequestStateSchema.literals) {
    it.effect(`maps status ${state} to resource state via get and list`, () =>
      withLocalServer(
        (request) => {
          if (request.pathname === "/documents" && request.query.has("page")) {
            return Promise.resolve({
              status: 200,
              body: JSON.stringify({
                documents: [{ key: `list-${state}`, status: state }],
                page_infos: { current_page: 1 },
              }),
            });
          }

          if (request.pathname.startsWith("/documents/") && request.method === "GET") {
            const id = request.pathname.replace("/documents/", "");
            return Promise.resolve({
              status: 200,
              body: JSON.stringify({
                document: {
                  key: id,
                  status: state,
                },
              }),
            });
          }

          return Promise.resolve({ status: 404, body: "not implemented" });
        },
        (server) =>
          Effect.gen(function* () {
            const options = clicksignOptions(server.baseUrl);

            const read = yield* getClicksignSignatureRequest(options, `request-${state}`).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(read.state).toBe(state);

            const listed = yield* listClicksignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBe(1);
            const first = listed[0];
            expect(first).toBeDefined();
            if (first === undefined) {
              return;
            }
            expect(first.id).toBe(`list-${state}`);
            expect(first.state).toBe(state);
          }),
      ),
    );
  }

  it.effect("decodes list pagination across two pages", () =>
    withLocalServer(
      (request) => {
        if (request.pathname !== "/documents" || request.method !== "GET") {
          return Promise.resolve({ status: 404, body: "not implemented" });
        }

        const page = request.query.get("page");
        if (page === "1") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              documents: [
                { key: "page-1-draft", status: "draft" },
                { key: "page-1-completed", status: "completed" },
              ],
              page_infos: {
                current_page: 1,
                total_pages: 2,
                next_page: 2,
              },
            }),
          });
        }

        if (page === "2") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              documents: [
                { key: "page-2-declined", status: "declined" },
                { key: "page-2-expired", status: "expired" },
              ],
              page_infos: {
                current_page: 2,
                total_pages: 2,
                last_page: true,
              },
            }),
          });
        }

        return Promise.resolve({ status: 404, body: `unexpected page ${page}` });
      },
      (server) =>
        Effect.gen(function* () {
          const listed = yield* listClicksignSignatureRequests(
            clicksignOptions(server.baseUrl),
          ).pipe(Effect.provide(signatureHttpClientLive));

          expect(listed).toHaveLength(4);
          const stateById = new Map(listed.map((request) => [request.id, request.state]));
          expect(stateById.get("page-1-draft")).toBe("draft");
          expect(stateById.get("page-1-completed")).toBe("completed");
          expect(stateById.get("page-2-declined")).toBe("declined");
          expect(stateById.get("page-2-expired")).toBe("expired");

          const requestedPages = server.requests
            .filter((request) => request.pathname === "/documents" && request.method === "GET")
            .map((request) => request.query.get("page"));
          expect(requestedPages).toEqual(["1", "2"]);
        }),
    ),
  );

  it.effect("treats delete 404 as success", () =>
    withLocalServer(
      (request) => {
        if (request.method === "DELETE" && request.pathname === "/documents/doc-missing") {
          return Promise.resolve({ status: 404, body: "not found" });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const deleted = yield* deleteClicksignSignatureRequest(
            clicksignOptions(server.baseUrl),
            "doc-missing",
          ).pipe(Effect.provide(signatureHttpClientLive));
          expect(deleted).toBeUndefined();
        }),
    ),
  );

  it.effect("downloads signed bytes when provider returns signed_file_url", () =>
    withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/documents/signed") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              document: {
                key: "signed",
                status: "completed",
                download_url: "/files/signed-content",
              },
            }),
          });
        }

        if (request.method === "GET" && request.pathname === "/files/signed-content") {
          expect(request.query.get("access_token")).toBe(ACCESS_TOKEN);
          return Promise.resolve({
            status: 200,
            body: new TextEncoder().encode("signed document payload bytes"),
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const bytes = yield* downloadClicksignSignedDocument(
            clicksignOptions(server.baseUrl),
            "signed",
          ).pipe(Effect.provide(signatureHttpClientLive));
          expect(Buffer.from(bytes).toString("utf8")).toBe("signed document payload bytes");
        }),
    ),
  );

  it.effect("gates download when signed URL is unavailable", () =>
    withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/documents/unsigned") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              document: {
                key: "unsigned",
                status: "draft",
              },
            }),
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            downloadClicksignSignedDocument(clicksignOptions(server.baseUrl), "unsigned").pipe(
              Effect.provide(signatureHttpClientLive),
            ),
          );
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(result.failure.provider).toBe("clicksign");
          }
        }),
    ),
  );

  it.effect("masks real access token inside failed token-bearing download URLs", () => {
    let fullDownloadUrl = "";

    return withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/documents/tokenized") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              document: {
                key: "tokenized",
                status: "completed",
                download_url: fullDownloadUrl,
              },
            }),
          });
        }

        if (request.method === "GET" && request.pathname === "/files/tokenized-download") {
          return Promise.resolve({
            status: 403,
            body: JSON.stringify({ error: "forbidden" }),
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          fullDownloadUrl = `${server.baseUrl}/files/tokenized-download?access_token=${ACCESS_TOKEN}`;

          const result = yield* Effect.result(
            downloadClicksignSignedDocument(clicksignOptions(server.baseUrl), "tokenized").pipe(
              Effect.provide(signatureHttpClientLive),
            ),
          );
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.http);
            expect(result.failure.reason).toBeDefined();
            if (result.failure.reason === undefined) {
              return;
            }
            const reason = decodeURIComponent(result.failure.reason);
            expect(reason).toContain("<redacted>");
            expect(result.failure.reason).not.toContain(ACCESS_TOKEN);
            expect(reason).not.toContain(ACCESS_TOKEN);
          }
        }),
    );
  });

  const followUpStatuses: ReadonlyArray<number> = [500, 422];

  for (const followUpStatus of followUpStatuses) {
    const shouldRollback = followUpStatus === 422;
    it.effect(
      `rolls ${shouldRollback ? "back" : "does not roll back"} create when /signers returns ${followUpStatus}`,
      () =>
        withLocalServer(
          (request) => {
            if (request.method === "POST" && request.pathname === "/documents") {
              return Promise.resolve({
                status: 200,
                body: JSON.stringify({ document: { key: "rollback-doc", status: "draft" } }),
              });
            }

            if (request.method === "POST" && request.pathname === "/signers") {
              return Promise.resolve({
                status: followUpStatus,
                body: JSON.stringify({ error: "signer rejected" }),
              });
            }

            if (request.method === "DELETE" && request.pathname === "/documents/rollback-doc") {
              return Promise.resolve({ status: 200, body: JSON.stringify({}) });
            }

            return Promise.resolve({ status: 404, body: "not found" });
          },
          (server) =>
            Effect.gen(function* () {
              const result = yield* Effect.result(reconcileClicksign(defaultInput(), server));
              expect(Result.isFailure(result)).toBe(true);
              if (Result.isFailure(result)) {
                expect(result.failure.status).toBe(followUpStatus);
              }

              const deleteCalls = server.requests.filter(
                (request) =>
                  request.pathname === "/documents/rollback-doc" && request.method === "DELETE",
              );
              expect(deleteCalls.length).toBe(shouldRollback ? 1 : 0);
            }),
        ),
    );
  }
});
