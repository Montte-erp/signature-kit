import { SignatureKitErrorCodeValue } from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import {
  AssinafySignatureRequest,
  AssinafySignatureRequestProvider,
  assinafyCredentialsLayer,
  deleteAssinafySignatureRequest,
  downloadAssinafySignedDocument,
  getAssinafySignatureRequest,
  listAssinafySignatureRequests,
  type AssinafyProviderOptions,
  type AssinafySignatureRequestProps,
  type AssinafySignatureRequestState,
} from "../src/index";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import {
  closeLocalServer,
  parseBodyAsJson,
  startLocalServer,
  type LocalResponse,
} from "../../__tests__/local-http";

const API_KEY = "local-assinafy-api-key";
const ACCOUNT_ID = "account-local";

const makeProviderOptions = (baseUrl: string): AssinafyProviderOptions => ({
  accountId: ACCOUNT_ID,
  apiKey: Redacted.make(API_KEY),
  baseUrl,
});

const reconcileAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  request: AssinafySignatureRequestProps,
) =>
  Effect.gen(function* () {
    const provider = yield* AssinafySignatureRequest.Provider;
    return yield* provider.reconcile(reconcileResourceProps("assinafy-local-request", request));
  }).pipe(
    Effect.provide(AssinafySignatureRequestProvider()),
    Effect.provide(assinafyCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

type StateFixture = {
  readonly id: string;
  readonly status: string;
  readonly assignment?: {
    readonly id: string;
    readonly status?: string;
  };
  readonly artifacts?: {
    readonly certificated?: string;
    readonly original?: string;
    readonly thumbnail?: string;
  };
  readonly expectedState: AssinafySignatureRequestState;
};

const stateFixture: readonly StateFixture[] = [
  {
    id: "req-draft",
    status: "metadata_ready",
    expectedState: "draft",
  },
  {
    id: "req-sent",
    status: "waiting_signature",
    expectedState: "sent",
  },
  {
    id: "req-completed",
    status: "completed",
    expectedState: "completed",
  },
  {
    id: "req-cancelled",
    status: "cancelled",
    expectedState: "cancelled",
  },
  {
    id: "req-deleted",
    status: "deleted",
    expectedState: "deleted",
  },
  {
    id: "req-declined",
    status: "rejected_by_user",
    expectedState: "declined",
  },
  {
    id: "req-expired",
    status: "expired",
    expectedState: "expired",
  },
];

const signedBytes = new TextEncoder().encode("Assinafy signed binary");

describe("Assinafy local API", () => {
  it.effect("sends correct create/reconcile path, method, auth, and request payloads", () =>
    Effect.gen(function* () {
      const createInput: AssinafySignatureRequestProps = {
        title: "SignatureKit local Assinafy document",
        message: "Please sign the attachment",
        documents: [
          {
            fileName: "contract.pdf",
            mimeType: "application/pdf",
            contentBase64: Buffer.from("%PDF-1.4\n%local assinafy\n").toString("base64"),
          },
        ],
        recipients: [
          { name: "Alice Local", email: "alice@local.example", routingOrder: 3 },
          { name: "Bob Local", email: "bob@local.example" },
        ],
        send: false,
        expiresAt: new Date("2024-01-31T00:00:00.000Z"),
      };

      const local = yield* startLocalServer((request): Promise<LocalResponse> => {
        if (
          request.method === "POST" &&
          request.pathname === "/v1/accounts/account-local/documents"
        ) {
          if (request.headers["x-api-key"] !== API_KEY) {
            return Promise.resolve({ status: 401, body: "missing api key" });
          }
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: {
                id: "document-local-1",
                signing_url: "https://example.assinafy.local/signing-url",
              },
            }),
          });
        }
        if (request.method === "GET" && request.pathname === "/v1/documents/document-local-1") {
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: {
                id: "document-local-1",
                status: "completed",
                signing_url: "https://example.assinafy.local/signing-url",
              },
            }),
          });
        }

        if (
          request.method === "POST" &&
          request.pathname === "/v1/accounts/account-local/signers"
        ) {
          const body = parseBodyAsJson<{ full_name: string; email: string }>(request.body);
          const signerId =
            body.email === "alice@local.example"
              ? "signer-alice"
              : body.email === "bob@local.example"
                ? "signer-bob"
                : "signer-unknown";
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: { id: signerId } }),
          });
        }

        if (
          request.method === "POST" &&
          request.pathname === "/v1/documents/document-local-1/assignments"
        ) {
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: {
                id: "assignment-local-1",
                signing_urls: [
                  { signer_id: "signer-alice", url: "https://example.assinafy.local/signing" },
                ],
              },
            }),
          });
        }

        return Promise.resolve({ status: 404, body: "not-found" });
      });

      try {
        const options = makeProviderOptions(local.baseUrl);
        const request = yield* reconcileAssinafySignatureRequest(options, createInput);

        expect(request.provider).toBe("assinafy");
        expect(request.id).toBe("document-local-1");
        expect(request.detailsUrl).toBe(`${local.baseUrl}/v1/documents/document-local-1`);

        const documentRequest = local.requests.find(
          (entry) => entry.pathname === "/v1/accounts/account-local/documents",
        );
        expect(documentRequest).toBeDefined();
        expect(documentRequest?.method).toBe("POST");
        expect(documentRequest?.headers["x-api-key"]).toBe(API_KEY);
        expect(documentRequest?.headers["content-type"]).toContain("multipart/form-data");
        expect(documentRequest?.body).toContain('name="file"');
        expect(documentRequest?.body).toContain('filename="contract.pdf"');

        const signerRequests = local.requests.filter(
          (entry) => entry.pathname === "/v1/accounts/account-local/signers",
        );
        expect(signerRequests).toHaveLength(2);
        const signerBodies = signerRequests.map((entry) =>
          parseBodyAsJson<{ full_name: string; email: string }>(entry.body),
        );
        expect(signerBodies).toEqual(
          expect.arrayContaining([
            { full_name: "Alice Local", email: "alice@local.example" },
            { full_name: "Bob Local", email: "bob@local.example" },
          ]),
        );
        for (const signerRequest of signerRequests) {
          expect(signerRequest.headers["x-api-key"]).toBe(API_KEY);
          expect(signerRequest.headers["content-type"]).toContain("application/json");
        }

        const assignmentRequest = local.requests.find(
          (entry) => entry.pathname === "/v1/documents/document-local-1/assignments",
        );
        expect(assignmentRequest).toBeDefined();
        expect(assignmentRequest?.method).toBe("POST");
        expect(assignmentRequest?.headers["x-api-key"]).toBe(API_KEY);
        expect(assignmentRequest?.headers["content-type"]).toContain("application/json");

        const assignmentBody = parseBodyAsJson<{
          readonly method: string;
          readonly signers: readonly {
            readonly id: string;
            readonly verification_method: string;
            readonly notification_methods: readonly string[];
            readonly step: number;
          }[];
          readonly message?: string;
          readonly expires_at?: string;
        }>(assignmentRequest?.body ?? "{}");

        expect(assignmentBody.method).toBe("virtual");
        expect(assignmentBody.signers).toHaveLength(2);
        expect(assignmentBody.signers).toEqual(
          expect.arrayContaining([
            {
              id: "signer-alice",
              verification_method: "Email",
              notification_methods: [],
              step: 3,
            },
            {
              id: "signer-bob",
              verification_method: "Email",
              notification_methods: [],
              step: 2,
            },
          ]),
        );
        expect(assignmentBody.message).toBe(createInput.message);
        if (createInput.expiresAt !== undefined) {
          expect(assignmentBody.expires_at).toBe(createInput.expiresAt.toISOString());
        } else {
          expect(assignmentBody.expires_at).toBeUndefined();
        }
      } finally {
        yield* closeLocalServer(local.server);
      }
    }),
  );

  it.effect("maps all contract states from get and paginates list across empty-trailer page", () =>
    Effect.gen(function* () {
      const page1 = stateFixture.slice(0, 3);
      const page2 = stateFixture.slice(3);
      const local = yield* startLocalServer((request): Promise<LocalResponse> => {
        if (request.method === "GET") {
          const documentMatch = request.pathname.match(/^\/v1\/documents\/([^/]+)$/);
          if (documentMatch !== null) {
            const id = documentMatch[1];
            const fixture = stateFixture.find((entry) => entry.id === id);
            if (fixture === undefined) {
              return Promise.resolve({ status: 404, body: "not-found" });
            }
            return Promise.resolve({
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                data: {
                  id: fixture.id,
                  status: fixture.status,
                  ...(fixture.assignment === undefined ? {} : { assignment: fixture.assignment }),
                  ...(fixture.artifacts === undefined ? {} : { artifacts: fixture.artifacts }),
                },
              }),
            });
          }

          if (request.pathname === "/v1/accounts/account-local/documents") {
            const page = request.query.get("page");
            if (page === "1") {
              return Promise.resolve({
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: page1.map((fixture) => ({
                    id: fixture.id,
                    status: fixture.status,
                  })),
                }),
              });
            }
            if (page === "2") {
              return Promise.resolve({
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: page2.map((fixture) => ({
                    id: fixture.id,
                    status: fixture.status,
                  })),
                }),
              });
            }
            if (page === "3") {
              return Promise.resolve({
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: [] }),
              });
            }
            return Promise.resolve({ status: 404, body: "not-found" });
          }
        }

        return Promise.resolve({ status: 404, body: "not-found" });
      });

      try {
        const options = makeProviderOptions(local.baseUrl);

        const getMapped = yield* Effect.forEach(
          stateFixture,
          ({ id, status, expectedState }) =>
            getAssinafySignatureRequest(options, id).pipe(
              Effect.provide(signatureHttpClientLive),
              Effect.map((request) => ({
                id,
                status,
                expectedState,
                mappedState: request.state,
                providerStatus: request.providerStatus,
              })),
            ),
          { concurrency: "unbounded" },
        );

        for (const mapped of getMapped) {
          expect(mapped.providerStatus).toBe(mapped.status);
          expect(mapped.mappedState).toBe(mapped.expectedState);
        }

        const listed = yield* listAssinafySignatureRequests(options).pipe(
          Effect.provide(signatureHttpClientLive),
        );
        expect(listed).toHaveLength(stateFixture.length);

        for (const fixture of stateFixture) {
          const request = listed.find((entry) => entry.id === fixture.id);
          expect(request).toBeDefined();
          expect(request?.state).toBe(fixture.expectedState);
          expect(request?.providerStatus).toBe(fixture.status);
        }

        const listRequests = local.requests.filter(
          (request) => request.pathname === "/v1/accounts/account-local/documents",
        );
        expect(listRequests.map((request) => request.query.get("page"))).toEqual(["1", "2", "3"]);
        for (const request of listRequests) {
          expect(request.method).toBe("GET");
          expect(request.query.get("per_page")).toBe("100");
          expect(request.headers["x-api-key"]).toBe(API_KEY);
        }
      } finally {
        yield* closeLocalServer(local.server);
      }
    }),
  );

  it.effect("treats delete-not-found as successful deletion", () =>
    Effect.gen(function* () {
      const local = yield* startLocalServer((request): Promise<LocalResponse> => {
        if (
          request.method === "DELETE" &&
          request.pathname === "/v1/accounts/account-local/documents/request-to-delete"
        ) {
          return Promise.resolve({ status: 404, body: "already-deleted" });
        }
        return Promise.resolve({ status: 404, body: "not-found" });
      });

      try {
        const options = makeProviderOptions(local.baseUrl);
        const deleted = yield* deleteAssinafySignatureRequest(options, "request-to-delete").pipe(
          Effect.provide(signatureHttpClientLive),
        );

        expect(deleted).toBeUndefined();
        expect(local.requests).toHaveLength(1);
        expect(local.requests[0]?.method).toBe("DELETE");
        expect(local.requests[0]?.headers["x-api-key"]).toBe(API_KEY);
      } finally {
        yield* closeLocalServer(local.server);
      }
    }),
  );
  it.effect("downloads bytes only when state is completed and certificated artifact exists", () =>
    Effect.gen(function* () {
      const local = yield* startLocalServer((request): Promise<LocalResponse> => {
        if (request.method === "GET" && request.pathname === "/v1/documents/request-completed") {
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: {
                id: "request-completed",
                status: "completed",
                artifacts: {
                  certificated: `http://${request.headers.host}/signed/completed-request`,
                },
              },
            }),
          });
        }

        if (request.method === "GET" && request.pathname === "/signed/completed-request") {
          return Promise.resolve({
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
            body: signedBytes,
          });
        }

        return Promise.resolve({ status: 404, body: "not-found" });
      });

      try {
        const options = makeProviderOptions(local.baseUrl);
        const bytes = yield* downloadAssinafySignedDocument(options, "request-completed").pipe(
          Effect.provide(signatureHttpClientLive),
        );

        expect(new TextDecoder().decode(bytes)).toBe("Assinafy signed binary");
        const downloadCall = local.requests.find(
          (request) => request.pathname === "/signed/completed-request",
        );
        expect(downloadCall).toBeDefined();
        expect(downloadCall?.method).toBe("GET");
        expect(downloadCall?.headers["x-api-key"]).toBe(API_KEY);
      } finally {
        yield* closeLocalServer(local.server);
      }
    }),
  );

  it.effect("returns unsupportedOperation when downloading before signed artifact exists", () =>
    Effect.gen(function* () {
      const local = yield* startLocalServer((request): Promise<LocalResponse> => {
        if (request.method === "GET") {
          const documentMatch = request.pathname.match(/^\/v1\/documents\/([^/]+)$/);
          if (documentMatch !== null) {
            const id = documentMatch[1];
            if (id === "request-draft") {
              return Promise.resolve({
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: {
                    id,
                    status: "metadata_ready",
                  },
                }),
              });
            }

            if (id === "request-completed-no-cert") {
              return Promise.resolve({
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data: {
                    id,
                    status: "completed",
                    artifacts: {
                      original: "/original/request-completed-no-cert",
                    },
                  },
                }),
              });
            }
          }
        }

        return Promise.resolve({ status: 404, body: "not-found" });
      });

      try {
        const options = makeProviderOptions(local.baseUrl);
        const scenarios = [
          {
            id: "request-draft",
          },
          {
            id: "request-completed-no-cert",
          },
        ];

        for (const scenario of scenarios) {
          const download = yield* Effect.result(
            downloadAssinafySignedDocument(options, scenario.id).pipe(
              Effect.provide(signatureHttpClientLive),
            ),
          );
          expect(Result.isFailure(download)).toBe(true);
          if (Result.isFailure(download)) {
            expect(download.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(download.failure.provider).toBe("assinafy");
            expect(download.failure.reason).toContain("signed document does not exist yet.");
          }
        }

        const downloadCalls = local.requests.filter(
          (request) =>
            request.pathname === "/signed/completed-request" ||
            request.pathname === "/original/request-completed-no-cert",
        );
        expect(downloadCalls).toHaveLength(0);
      } finally {
        yield* closeLocalServer(local.server);
      }
    }),
  );
});
