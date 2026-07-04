import { type SignatureKitError, SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { signatureHttpClientLive } from "@signature-kit/http";
import { describe, expect, it } from "@effect/vitest";
import {
  expectProviderListResult,
  jsonBody,
  localHttpServer,
  type LocalRequest,
  type LocalResponse,
  type LocalServer,
} from "../../../tooling/testing/local-http";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Result } from "effect";
import {
  type DocumensoEnvelopeState,
  type DocumensoEnvelope,
  DocumensoEnvelopeStateSchema,
  DocumensoSignatureRequest,
  DocumensoSignatureRequestProvider,
  deleteDocumensoSignatureRequest,
  downloadDocumensoSignedDocument,
  type DocumensoEnvelopeProps,
  type DocumensoProviderOptions,
  documensoCredentialsLayer,
  getDocumensoSignatureRequest,
  listDocumensoSignatureRequests,
} from "../src/index";

const API_KEY = "documenso-local-token";
const LOCAL_DOCUMENT_BYTES = new TextEncoder().encode("Documenso local file bytes");
const LOCAL_DOCUMENT_BASE64 = Buffer.from(LOCAL_DOCUMENT_BYTES).toString("base64");

const defaultInput = (): DocumensoEnvelopeProps => ({
  title: "SignatureKit Documenso local offline",
  subject: "SignatureKit local subject",
  message: "SignatureKit local message",
  documents: [
    {
      fileName: "signature-kit-offline.pdf",
      mimeType: "application/pdf",
      contentBase64: LOCAL_DOCUMENT_BASE64,
    },
  ],
  recipients: [
    {
      name: "Offline Signer",
      email: "signer@example.org",
      role: "signer",
      routingOrder: 1,
    },
  ],
  send: false,
  redirectUrl: "https://example.org/documenso-callback",
});

const documensoOptions = (baseUrl: string): DocumensoProviderOptions => ({
  apiKey: Redacted.make(API_KEY),
  baseUrl,
  authorizationScheme: "raw",
});

const reconcileDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  request: DocumensoEnvelopeProps,
): Effect.Effect<DocumensoEnvelope, SignatureKitError, never> =>
  Effect.gen(function* () {
    const provider = yield* DocumensoSignatureRequest.Provider;
    return yield* provider.reconcile(reconcileResourceProps("documenso-local", request));
  }).pipe(
    Effect.provide(DocumensoSignatureRequestProvider()),
    Effect.provide(documensoCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

const withLocalServer = <A, E, R>(
  handler: (request: LocalRequest) => Promise<LocalResponse>,
  run: (server: LocalServer) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  localHttpServer(handler).pipe(
    Effect.flatMap((server) => run(server)),
    Effect.scoped,
  );

const remoteStatusFromState = (state: DocumensoEnvelopeState): string => {
  switch (state) {
    case "draft":
      return "DRAFT";
    case "sent":
      return "PROCESSING";
    case "completed":
      return "SIGNED";
    case "cancelled":
      return "CANCELLED";
    case "deleted":
      return "DELETED";
    case "declined":
      return "REJECTED";
    case "expired":
      return "EXPIRED";
  }
};

const allStateFixtures = DocumensoEnvelopeStateSchema.literals.map((state) => ({
  id: `state-${state}`,
  state,
  remoteStatus: remoteStatusFromState(state),
}));

type StateFixture = (typeof allStateFixtures)[number];

const assertNoSignedItemDownloadRequest = (server: LocalServer): void => {
  const itemDownloadRequests = server.requests.filter(
    (request) =>
      request.pathname.startsWith("/envelope/item/") &&
      request.pathname.endsWith("/download") &&
      request.query.get("version") === "signed",
  );
  expect(itemDownloadRequests).toHaveLength(0);
};

const extractMultipartField = (request: LocalRequest, fieldName: string): string | undefined => {
  const contentType = request.headers["content-type"];
  if (contentType === undefined) return undefined;

  const boundaryMatch = /boundary=(.+)$/.exec(contentType);
  if (boundaryMatch === null) return undefined;

  const boundary = boundaryMatch[1];
  const boundaryToken = `--${boundary}`;
  const parts = request.body.split(boundaryToken);

  for (const part of parts) {
    if (!part.includes(`name="${fieldName}"`)) continue;

    const [rawHeaders, ...rest] = part
      .replace(/^\r?\n/, "")
      .trim()
      .split("\r\n\r\n");
    if (rawHeaders === undefined || rawHeaders.includes(`name="${fieldName}"`) === false) continue;

    const body = rest.join("\r\n\r\n");
    return body.replace(/\r?\n--?$/, "");
  }

  return undefined;
};

describe("Documenso offline provider", () => {
  it.effect("returns no entries and skips upstream list for retained provider list hook", () =>
    withLocalServer(
      () => Promise.resolve({ status: 500, body: "unexpected request" }),
      (server) =>
        Effect.gen(function* () {
          const options = documensoOptions(server.baseUrl);
          const result = yield* Effect.gen(function* () {
            const provider = yield* DocumensoSignatureRequest.Provider;
            return yield* provider.list();
          }).pipe(
            Effect.provide(DocumensoSignatureRequestProvider()),
            Effect.provide(documensoCredentialsLayer(options)),
            Effect.provide(signatureHttpClientLive),
          );

          expect(server.requests).toHaveLength(0);
          expectProviderListResult(result);
        }),
    ),
  );
  it.effect("reconciles create requests with expected path/method/auth/body", () =>
    withLocalServer(
      (request) => {
        if (request.method === "POST" && request.pathname === "/envelope/create") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ id: "created-local-envelope" }),
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const options = documensoOptions(server.baseUrl);
          const input = defaultInput();
          const created = yield* reconcileDocumensoSignatureRequest(options, input);

          expect(created.id).toBe("created-local-envelope");
          expect(created.state).toBe("draft");
          expect(created.provider).toBe("documenso");

          const createRequest = server.requests.find(
            (request) => request.method === "POST" && request.pathname === "/envelope/create",
          );
          expect(createRequest).toBeDefined();
          if (createRequest === undefined) {
            return;
          }
          expect(createRequest.pathname).toBe("/envelope/create");
          expect(createRequest.method).toBe("POST");
          expect(createRequest.headers["authorization"]).toBe(API_KEY);
          expect(createRequest.headers["content-type"]).toContain("multipart/form-data");
          expect(createRequest.body).toContain(
            'name="files"; filename="signature-kit-offline.pdf"',
          );

          const payloadText = extractMultipartField(createRequest, "payload");
          expect(payloadText).toBeDefined();
          if (payloadText === undefined) {
            return;
          }
          const requestRecipient = input.recipients[0];
          expect(requestRecipient).toBeDefined();
          if (requestRecipient === undefined) {
            return;
          }
          expect(jsonBody(payloadText)).toMatchObject({
            type: "DOCUMENT",
            title: input.title,
            recipients: [
              {
                name: requestRecipient.name,
                email: requestRecipient.email,
                role: "SIGNER",
                signingOrder: requestRecipient.routingOrder,
              },
            ],
            meta: {
              subject: input.subject,
              message: input.message,
              redirectUrl: input.redirectUrl,
            },
          });

          const createCalls = server.requests.filter(
            (request) => request.method === "POST" && request.pathname === "/envelope/create",
          );
          expect(createCalls).toHaveLength(1);
        }),
    ),
  );

  it.effect(
    "maps every local envelope state for get and list and pages list across two pages",
    () =>
      withLocalServer(
        (request) => {
          if (request.pathname === "/envelope" && request.method === "GET") {
            const page = request.query.get("page") ?? "1";
            const firstPage = allStateFixtures.slice(0, 4);
            const secondPage = allStateFixtures.slice(4);

            if (page === "1") {
              return Promise.resolve({
                status: 200,
                body: JSON.stringify({
                  data: firstPage.map((fixture) => ({
                    id: fixture.id,
                    status: fixture.remoteStatus,
                    envelopeItems:
                      fixture.state === "completed" ? [{ id: "item-complete" }] : undefined,
                  })),
                  pagination: {
                    page: 1,
                    perPage: 100,
                    totalPages: 2,
                    totalItems: allStateFixtures.length,
                  },
                }),
              });
            }

            if (page === "2") {
              return Promise.resolve({
                status: 200,
                body: JSON.stringify({
                  data: secondPage.map((fixture) => ({
                    id: fixture.id,
                    status: fixture.remoteStatus,
                  })),
                  pagination: {
                    page: 2,
                    perPage: 100,
                    totalPages: 2,
                    totalItems: allStateFixtures.length,
                  },
                }),
              });
            }

            return Promise.resolve({ status: 404, body: "not found" });
          }

          if (request.pathname.startsWith("/envelope/") && request.method === "GET") {
            const id = request.pathname.replace("/envelope/", "");
            const fixture = allStateFixtures.find((entry) => entry.id === id);
            if (fixture === undefined) {
              return Promise.resolve({ status: 404, body: "not found" });
            }

            return Promise.resolve({
              status: 200,
              body: JSON.stringify({
                id: fixture.id,
                status: fixture.remoteStatus,
              }),
            });
          }

          return Promise.resolve({ status: 404, body: "not found" });
        },
        (server) =>
          Effect.gen(function* () {
            const options = documensoOptions(server.baseUrl);

            const listById = new Map<string, StateFixture>(
              allStateFixtures.map((fixture) => [fixture.id, fixture]),
            );

            for (const fixture of allStateFixtures) {
              const request = yield* getDocumensoSignatureRequest(options, fixture.id).pipe(
                Effect.provide(signatureHttpClientLive),
              );

              expect(request.provider).toBe("documenso");
              expect(request.id).toBe(fixture.id);
              expect(request.state).toBe(fixture.state);
            }

            const listed = yield* listDocumensoSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed).toHaveLength(allStateFixtures.length);

            for (const request of listed) {
              const fixture = listById.get(request.id);
              expect(fixture).toBeDefined();
              expect(request.state).toBe(fixture?.state);
            }

            const listRequests = server.requests.filter(
              (value) => value.pathname === "/envelope" && value.method === "GET",
            );
            expect(listRequests).toHaveLength(2);
            const firstListRequest = listRequests[0];
            const secondListRequest = listRequests[1];
            expect(firstListRequest).toBeDefined();
            expect(secondListRequest).toBeDefined();
            if (firstListRequest === undefined || secondListRequest === undefined) {
              return;
            }
            expect(firstListRequest.query.get("page")).toBe("1");
            expect(secondListRequest.query.get("page")).toBe("2");
            expect(firstListRequest.query.get("perPage")).toBe("100");
            expect(secondListRequest.query.get("perPage")).toBe("100");
          }),
      ),
  );

  it.effect("treats delete 404 as success", () =>
    withLocalServer(
      (request) => {
        if (request.method === "POST" && request.pathname === "/envelope/delete") {
          return Promise.resolve({ status: 404, body: "not found" });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const deleted = yield* deleteDocumensoSignatureRequest(
            documensoOptions(server.baseUrl),
            "missing-envelope",
          ).pipe(Effect.provide(signatureHttpClientLive));

          expect(deleted).toBeUndefined();
          const deleteRequest = server.requests.find(
            (request) => request.method === "POST" && request.pathname === "/envelope/delete",
          );
          expect(deleteRequest).toBeDefined();
          expect(deleteRequest?.headers["authorization"]).toBe(API_KEY);
          expect(deleteRequest?.headers["content-type"]).toContain("application/json");

          expect(jsonBody(deleteRequest?.body ?? "{}")).toEqual({ envelopeId: "missing-envelope" });
        }),
    ),
  );

  it.effect("rejects draft envelope download as unsupportedOperation without item GET", () =>
    withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/envelope/draft-item-present") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              id: "draft-item-present",
              status: "DRAFT",
              envelopeItems: [{ id: "draft-download-item" }],
            }),
          });
        }

        if (
          request.method === "GET" &&
          request.pathname === "/envelope/item/draft-download-item/download" &&
          request.query.get("version") === "signed"
        ) {
          return Promise.resolve({
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: LOCAL_DOCUMENT_BYTES,
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            downloadDocumensoSignedDocument(
              documensoOptions(server.baseUrl),
              "draft-item-present",
            ).pipe(Effect.provide(signatureHttpClientLive)),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(result.failure.provider).toBe("documenso");
          }

          expect(server.requests).toHaveLength(1);
          const envelopeRequest = server.requests.find(
            (value) => value.pathname === "/envelope/draft-item-present" && value.method === "GET",
          );
          expect(envelopeRequest).toBeDefined();
          expect(envelopeRequest?.pathname).toBe("/envelope/draft-item-present");
          expect(envelopeRequest?.method).toBe("GET");

          assertNoSignedItemDownloadRequest(server);
        }),
    ),
  );

  it.effect("rejects pending envelope download as unsupportedOperation without item GET", () =>
    withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/envelope/pending-item-present") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              id: "pending-item-present",
              status: "PENDING",
              envelopeItems: [{ id: "pending-download-item" }],
            }),
          });
        }

        if (
          request.method === "GET" &&
          request.pathname === "/envelope/item/pending-download-item/download" &&
          request.query.get("version") === "signed"
        ) {
          return Promise.resolve({
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: LOCAL_DOCUMENT_BYTES,
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            downloadDocumensoSignedDocument(
              documensoOptions(server.baseUrl),
              "pending-item-present",
            ).pipe(Effect.provide(signatureHttpClientLive)),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(result.failure.provider).toBe("documenso");
          }

          expect(server.requests).toHaveLength(1);
          const envelopeRequest = server.requests.find(
            (value) =>
              value.pathname === "/envelope/pending-item-present" && value.method === "GET",
          );
          expect(envelopeRequest).toBeDefined();
          expect(envelopeRequest?.pathname).toBe("/envelope/pending-item-present");
          expect(envelopeRequest?.method).toBe("GET");

          assertNoSignedItemDownloadRequest(server);
        }),
    ),
  );

  it.effect("rejects completed envelope with missing signed item as unsupportedOperation", () =>
    withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/envelope/completed-item-missing") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              id: "completed-item-missing",
              status: "COMPLETED",
            }),
          });
        }

        if (
          request.method === "GET" &&
          request.pathname.startsWith("/envelope/item/") &&
          request.query.get("version") === "signed"
        ) {
          return Promise.resolve({
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: LOCAL_DOCUMENT_BYTES,
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            downloadDocumensoSignedDocument(
              documensoOptions(server.baseUrl),
              "completed-item-missing",
            ).pipe(Effect.provide(signatureHttpClientLive)),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(result.failure.provider).toBe("documenso");
          }

          expect(server.requests).toHaveLength(1);
          const envelopeRequest = server.requests.find(
            (value) =>
              value.pathname === "/envelope/completed-item-missing" && value.method === "GET",
          );
          expect(envelopeRequest).toBeDefined();
          expect(envelopeRequest?.pathname).toBe("/envelope/completed-item-missing");
          expect(envelopeRequest?.method).toBe("GET");

          assertNoSignedItemDownloadRequest(server);
        }),
    ),
  );

  it.effect("downloads signed document bytes", () => {
    const expectedBytes = new TextEncoder().encode("signed bytes payload from documenso local");
    return withLocalServer(
      (request) => {
        if (request.method === "GET" && request.pathname === "/envelope/signed") {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              id: "signed",
              status: "COMPLETED",
              envelopeItems: [{ id: "download-item" }],
            }),
          });
        }

        if (
          request.method === "GET" &&
          request.pathname === "/envelope/item/download-item/download" &&
          request.query.get("version") === "signed"
        ) {
          return Promise.resolve({
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: expectedBytes,
          });
        }

        return Promise.resolve({ status: 404, body: "not found" });
      },
      (server) =>
        Effect.gen(function* () {
          const downloaded = yield* downloadDocumensoSignedDocument(
            documensoOptions(server.baseUrl),
            "signed",
          ).pipe(Effect.provide(signatureHttpClientLive));

          expect(downloaded).toEqual(expectedBytes);

          const downloadRequest = server.requests.find(
            (request) => request.pathname === "/envelope/item/download-item/download",
          );
          expect(downloadRequest).toBeDefined();
          expect(downloadRequest?.method).toBe("GET");
          expect(downloadRequest?.query.get("version")).toBe("signed");
          expect(downloadRequest?.headers["authorization"]).toBe(API_KEY);
        }),
    );
  });

  const distributeFailureStatuses: ReadonlyArray<number> = [408, 409, 422, 429, 500];

  for (const status of distributeFailureStatuses) {
    const shouldRollback = status === 422;

    it.effect(
      `rolls back create on ${status} from distribute ${shouldRollback ? "with" : "without"} delete`,
      () =>
        withLocalServer(
          (request) => {
            if (request.method === "POST" && request.pathname === "/envelope/create") {
              return Promise.resolve({
                status: 200,
                body: JSON.stringify({ id: "rollback-envelope" }),
              });
            }

            if (request.method === "POST" && request.pathname === "/envelope/distribute") {
              return Promise.resolve({
                status,
                body: JSON.stringify({ reason: `distribute failed with ${status}` }),
              });
            }

            if (request.method === "POST" && request.pathname === "/envelope/delete") {
              return Promise.resolve({
                status: 200,
                body: JSON.stringify({}),
              });
            }

            return Promise.resolve({ status: 404, body: "not found" });
          },
          (server) =>
            Effect.gen(function* () {
              const input = {
                ...defaultInput(),
                send: true,
              };
              const result = yield* Effect.result(
                reconcileDocumensoSignatureRequest(documensoOptions(server.baseUrl), input),
              );
              expect(Result.isFailure(result)).toBe(true);

              if (Result.isFailure(result)) {
                expect(result.failure.code).toBe(SignatureKitErrorCodeValue.http);
                expect(result.failure.status).toBe(status);
              }

              const deleteCalls = server.requests.filter(
                (request) => request.method === "POST" && request.pathname === "/envelope/delete",
              );
              expect(deleteCalls.length).toBe(shouldRollback ? 1 : 0);
            }),
        ),
    );
  }
});
