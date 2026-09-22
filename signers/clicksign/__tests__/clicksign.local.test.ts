import { describe, expect, it } from "@effect/vitest";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import type { SignatureKitError } from "@signature-kit/signatures";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { jsonBody, localHttpServer } from "../../../tooling/testing/local-http";
import type { LocalRequest, LocalResponse, LocalServer } from "../../../tooling/testing/local-http";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { Context, Effect, Layer, Redacted, Result } from "effect";
import {
  ClicksignSignatureRequest,
  providers as clicksignProviders,
  deleteClicksignSignatureRequest,
  downloadClicksignSignedDocument,
  getClicksignSignatureRequest,
  listClicksignSignatureRequests,
} from "../src/index";
import type {
  ClicksignProviderOptions,
  ClicksignSignatureRequestAttributes,
  ClicksignSignatureRequestProps,
} from "../src/index";

class FirstClicksignProvider extends Context.Service<
  FirstClicksignProvider,
  Provider.ProviderService<ClicksignSignatureRequest>
>()("@signature-kit/clicksign/tests/FirstProvider") {}

class SecondClicksignProvider extends Context.Service<
  SecondClicksignProvider,
  Provider.ProviderService<ClicksignSignatureRequest>
>()("@signature-kit/clicksign/tests/SecondProvider") {}

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
    const provider = yield* Provider.findProvider(ClicksignSignatureRequest);
    return yield* provider.reconcile(reconcileResourceProps("clicksign-local", input));
  }).pipe(Effect.provide(clicksignProviders(options)), Effect.provide(signatureHttpClientLive));
};

const withLocalServer = <A, E, R>(
  handler: (request: LocalRequest) => Promise<LocalResponse>,
  run: (server: LocalServer) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  localHttpServer(handler).pipe(
    Effect.flatMap((server) => run(server)),
    Effect.scoped,
  );

const clicksignStatusCases: ReadonlyArray<{
  readonly label: string;
  readonly remoteStatus: string | undefined;
  readonly expectedState: ClicksignSignatureRequestAttributes["state"];
}> = [
  { label: "missing", remoteStatus: undefined, expectedState: "sent" },
  { label: "draft", remoteStatus: "draft", expectedState: "draft" },
  { label: "running", remoteStatus: "running", expectedState: "sent" },
  { label: "signed", remoteStatus: "signed", expectedState: "completed" },
  { label: "closed", remoteStatus: "closed", expectedState: "completed" },
  { label: "canceled", remoteStatus: "canceled", expectedState: "cancelled" },
  { label: "cancelled", remoteStatus: "cancelled", expectedState: "cancelled" },
  { label: "deleted", remoteStatus: "deleted", expectedState: "deleted" },
  { label: "declined", remoteStatus: "declined", expectedState: "declined" },
  { label: "expired", remoteStatus: "expired", expectedState: "expired" },
  { label: "unknown", remoteStatus: "waiting_for_pixie_dust", expectedState: "sent" },
];

describe("Clicksign local HTTP provider tests", () => {
  it.effect("returns no entries and skips upstream list for retained provider list hook", () =>
    localHttpServer(() => Promise.resolve({ status: 500, body: "unexpected request" })).pipe(
      Effect.flatMap((server) =>
        Effect.gen(function* () {
          const options = clicksignOptions(server.baseUrl);
          const result = yield* Effect.gen(function* () {
            const provider = yield* Provider.findProvider(ClicksignSignatureRequest);
            return yield* provider.list();
          }).pipe(
            Effect.provide(clicksignProviders(options)),
            Effect.provide(signatureHttpClientLive),
          );

          expect(server.requests).toHaveLength(0);
          expect(result).toEqual([]);
        }),
      ),
      Effect.scoped,
    ),
  );

  it.effect("isolates provider options inside one composed Layer graph", () =>
    Effect.gen(function* () {
      const handler = (request: LocalRequest): Promise<LocalResponse> => {
        const id = request.pathname.split("/").at(-1) ?? "missing";
        return Promise.resolve({
          status: 200,
          body: JSON.stringify({ document: { key: id, status: "running" } }),
        });
      };
      const firstServer = yield* localHttpServer(handler);
      const secondServer = yield* localHttpServer(handler);
      const firstLayer = Layer.effect(
        FirstClicksignProvider,
        Provider.findProvider(ClicksignSignatureRequest),
      ).pipe(
        Layer.provide(
          clicksignProviders({
            accessToken: Redacted.make("first-token"),
            baseUrl: firstServer.baseUrl,
            locale: "en-US",
          }),
        ),
      );
      const secondLayer = Layer.effect(
        SecondClicksignProvider,
        Provider.findProvider(ClicksignSignatureRequest),
      ).pipe(
        Layer.provide(
          clicksignProviders({
            accessToken: Redacted.make("second-token"),
            baseUrl: secondServer.baseUrl,
            locale: "en-US",
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const firstProvider = yield* FirstClicksignProvider;
        const secondProvider = yield* SecondClicksignProvider;
        if (firstProvider.read === undefined || secondProvider.read === undefined) {
          return yield* Effect.die("Clicksign provider must implement read.");
        }
        const olds = defaultInput();
        const [first, second] = yield* Effect.all(
          [
            firstProvider.read({
              id: "first",
              instanceId: "first-instance",
              olds,
              output: { provider: "clicksign", id: "first", state: "sent" },
            }),
            secondProvider.read({
              id: "second",
              instanceId: "second-instance",
              olds,
              output: { provider: "clicksign", id: "second", state: "sent" },
            }),
          ],
          { concurrency: "unbounded" },
        );
        return { firstProvider, secondProvider, first, second };
      }).pipe(
        Effect.provide(Layer.merge(firstLayer, secondLayer)),
        Effect.provide(signatureHttpClientLive),
      );

      expect(result.firstProvider).not.toBe(result.secondProvider);
      expect(result.first?.id).toBe("first");
      expect(result.second?.id).toBe("second");
      expect(firstServer.requests).toHaveLength(1);
      expect(secondServer.requests).toHaveLength(1);
      expect(firstServer.requests[0]?.query.get("access_token")).toBe("first-token");
      expect(secondServer.requests[0]?.query.get("access_token")).toBe("second-token");
    }).pipe(Effect.scoped),
  );

  it.effect("reconciles create requests with expected path/method/query token/body", () =>
    withLocalServer(
      (request) => {
        if (request.method === "POST" && request.pathname === "/documents") {
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
          expect(jsonBody(createRequest?.body ?? "{}")).toMatchObject({
            document: {
              path: "/signature-kit-offline.pdf",
              content_base64: `data:application/pdf;base64,${LOCAL_DOCUMENT_BASE64}`,
              locale: "en-US",
              auto_close: true,
              sequence_enabled: false,
            },
          });

          const signerRequest = server.requests.find(
            (value) => value.method === "POST" && value.pathname === "/signers",
          );
          expect(signerRequest).toBeDefined();
          expect(signerRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
          expect(signerRequest?.method).toBe("POST");
          expect(signerRequest?.pathname).toBe("/signers");
          const signerBody = jsonBody(signerRequest?.body ?? "{}");
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
          const listBody = jsonBody(listRequest?.body ?? "{}");
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

  for (const statusCase of clicksignStatusCases) {
    it.effect(`maps remote status ${statusCase.label} to resource state via get and list`, () =>
      withLocalServer(
        (request) => {
          if (request.pathname === "/documents" && request.query.has("page")) {
            return Promise.resolve({
              status: 200,
              body: JSON.stringify({
                documents: [
                  statusCase.remoteStatus === undefined
                    ? { key: `list-${statusCase.label}` }
                    : { key: `list-${statusCase.label}`, status: statusCase.remoteStatus },
                ],
                page_infos: { current_page: 1 },
              }),
            });
          }

          if (request.pathname.startsWith("/documents/") && request.method === "GET") {
            const id = request.pathname.replace("/documents/", "");
            return Promise.resolve({
              status: 200,
              body: JSON.stringify({
                document:
                  statusCase.remoteStatus === undefined
                    ? { key: id }
                    : { key: id, status: statusCase.remoteStatus },
              }),
            });
          }

          return Promise.resolve({ status: 404, body: "not implemented" });
        },
        (server) =>
          Effect.gen(function* () {
            const options = clicksignOptions(server.baseUrl);

            const read = yield* getClicksignSignatureRequest(
              options,
              `request-${statusCase.label}`,
            ).pipe(Effect.provide(signatureHttpClientLive));
            expect(read.state).toBe(statusCase.expectedState);

            const listed = yield* listClicksignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBe(1);
            const first = listed[0];
            expect(first).toBeDefined();
            if (first === undefined) {
              return;
            }
            expect(first.id).toBe(`list-${statusCase.label}`);
            expect(first.state).toBe(statusCase.expectedState);
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
          const downloadRequest = server.requests.find(
            (request) => request.pathname === "/files/signed-content" && request.method === "GET",
          );
          expect(downloadRequest).toBeDefined();
          expect(downloadRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
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

  it.effect("masks appended access token inside failed same-host download URLs", () => {
    let fullDownloadUrl = "";

    return withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/documents/appended-token") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              document: {
                key: "appended-token",
                status: "completed",
                download_url: fullDownloadUrl,
              },
            }),
          });
        }

        if (request.method === "GET" && request.pathname === "/files/appended-token-download") {
          return Promise.resolve({
            status: 403,
            body: JSON.stringify({ error: "forbidden" }),
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          fullDownloadUrl = `${server.baseUrl}/files/appended-token-download`;

          const result = yield* Effect.result(
            downloadClicksignSignedDocument(
              clicksignOptions(server.baseUrl),
              "appended-token",
            ).pipe(Effect.provide(signatureHttpClientLive)),
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

          const downloadRequest = server.requests.find(
            (request) => request.pathname === "/files/appended-token-download",
          );
          expect(downloadRequest?.query.get("access_token")).toBe(ACCESS_TOKEN);
        }),
    );
  });

  const followUpStatuses: ReadonlyArray<number> = [408, 409, 422, 429, 500];

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
                expect(result.failure.code).toBe(SignatureKitErrorCodeValue.http);
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

  it.effect("does not roll back when Clicksign notification fails", () =>
    withLocalServer(
      (request) => {
        if (request.method === "POST" && request.pathname === "/documents") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ document: { key: "notify-doc", status: "draft" } }),
          });
        }

        if (request.method === "POST" && request.pathname === "/signers") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ signer: { key: "notify-signer" } }),
          });
        }

        if (request.method === "POST" && request.pathname === "/lists") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ list: { request_signature_key: "notify-request" } }),
          });
        }

        if (request.method === "POST" && request.pathname === "/notifications") {
          return Promise.resolve({
            status: 422,
            body: JSON.stringify({ error: "notification failed" }),
          });
        }

        if (request.method === "DELETE" && request.pathname === "/documents/notify-doc") {
          return Promise.resolve({ status: 200, body: JSON.stringify({}) });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            reconcileClicksign({ ...defaultInput(), send: true }, server),
          );
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.http);
            expect(result.failure.status).toBe(422);
          }

          const deleteCalls = server.requests.filter(
            (request) =>
              request.pathname === "/documents/notify-doc" && request.method === "DELETE",
          );
          expect(deleteCalls).toHaveLength(0);
        }),
    ),
  );
});
