import { describe, expect, it } from "@effect/vitest";
import { SignatureKitErrorCodeValue, type SignatureKitError } from "@signature-kit/signatures";
import { signatureHttpClientLive, type SignatureHttpClient } from "@signature-kit/http";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import {
  expectProviderListResult,
  jsonBody,
  localHttpServer,
  type LocalRequest,
  type LocalResponse,
} from "../../../tooling/testing/local-http";
import { Effect, Redacted, Result } from "effect";
import {
  DocuSealSignatureRequest,
  DocuSealSignatureRequestProvider,
  deleteDocuSealSignatureRequest,
  downloadDocuSealSignedDocument,
  docuSealCredentialsLayer,
  getDocuSealSignatureRequest,
  listDocuSealSignatureRequests,
  type DocuSealProviderOptions,
  type DocuSealSubmissionProps,
  type DocuSealSubmissionState,
} from "../src/index";

const API_KEY = "docuseal-local-token";
const sampleContent = new TextEncoder().encode("local docuSeal test payload");
const sampleContentBase64 = Buffer.from(sampleContent).toString("base64");

const submissionPayload: DocuSealSubmissionProps = {
  title: "DocuSeal local test",
  subject: "SignatureKit local unit",
  message: "offline test message",
  documents: [
    {
      fileName: "document.txt",
      mimeType: "text/plain",
      contentBase64: sampleContentBase64,
    },
  ],
  recipients: [
    {
      name: "Signer One",
      email: "signer@example.com",
      role: "signer",
      routingOrder: 1,
    },
  ],
  send: false,
};

type StateCase = {
  id: string;
  remoteStatus: string;
  localState: DocuSealSubmissionState;
};

const STATE_CASES: readonly StateCase[] = [
  { id: "state-draft", remoteStatus: "draft", localState: "draft" },
  { id: "state-sent", remoteStatus: "sent", localState: "sent" },
  { id: "state-completed", remoteStatus: "completed", localState: "completed" },
  { id: "state-cancelled", remoteStatus: "cancelled", localState: "cancelled" },
  { id: "state-declined", remoteStatus: "declined", localState: "declined" },
  { id: "state-deleted", remoteStatus: "deleted", localState: "deleted" },
  { id: "state-expired", remoteStatus: "expired", localState: "expired" },
];

const providerOptions = (baseUrl: string): DocuSealProviderOptions => ({
  apiKey: Redacted.make(API_KEY),
  baseUrl,
  sendSms: false,
  submittersOrder: "preserved",
});

const withLocalServer = <A, E = SignatureKitError>(
  handler: (request: LocalRequest, baseUrl: string) => Promise<LocalResponse>,
  run: (
    options: DocuSealProviderOptions,
    requests: readonly LocalRequest[],
  ) => Effect.Effect<A, E, SignatureHttpClient>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    let baseUrl = "";
    const local = yield* localHttpServer(async (request) => handler(request, baseUrl));
    baseUrl = local.baseUrl;
    const options = providerOptions(baseUrl);
    return yield* run(options, local.requests).pipe(Effect.provide(signatureHttpClientLive));
  }).pipe(Effect.scoped);

describe("DocuSeal offline provider", () => {
  it.effect("returns no entries and skips upstream list for retained provider list hook", () =>
    withLocalServer(
      async () =>
        Promise.resolve({
          status: 500,
          body: "unexpected request",
        }),
      (options, requests) =>
        Effect.gen(function* () {
          const result = yield* Effect.gen(function* () {
            const provider = yield* DocuSealSignatureRequest.Provider;
            return yield* provider.list();
          }).pipe(
            Effect.provide(DocuSealSignatureRequestProvider()),
            Effect.provide(docuSealCredentialsLayer(options)),
          );

          expect(requests).toHaveLength(0);
          expectProviderListResult(result);
        }),
    ),
  );

  it.effect("reconcile sends POST /submissions/pdf with expected auth and body", () =>
    withLocalServer(
      async (request, baseUrl) => {
        if (request.method === "POST" && request.pathname === "/submissions/pdf") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: "created-id",
              status: "draft",
              submitters: [
                {
                  name: "Signer One",
                  email: "signer@example.com",
                  role: "signer",
                  order: 1,
                },
              ],
              combined_document_url: `${baseUrl}/documents/created-id`,
            }),
          };
        }

        return { status: 404, body: "not found" };
      },
      (options, requests) =>
        Effect.gen(function* () {
          const created = yield* Effect.gen(function* () {
            const provider = yield* DocuSealSignatureRequest.Provider;
            return yield* provider.reconcile(
              reconcileResourceProps("docuseal-offline-create", submissionPayload),
            );
          }).pipe(
            Effect.provide(DocuSealSignatureRequestProvider()),
            Effect.provide(docuSealCredentialsLayer(options)),
          );

          expect(created.id).toBe("created-id");
          expect(created.state).toBe("draft");
          expect(created.provider).toBe("docuseal");

          expect(requests).toHaveLength(1);
          const createRequest = requests[0];
          expect(createRequest).toBeDefined();
          if (createRequest !== undefined) {
            expect(createRequest.pathname).toBe("/submissions/pdf");
            expect(createRequest.method).toBe("POST");
            expect(createRequest.headers["x-auth-token"]).toBe(API_KEY);

            const firstDocument = submissionPayload.documents[0];
            const firstRecipient = submissionPayload.recipients[0];
            expect(firstDocument).toBeDefined();
            expect(firstRecipient).toBeDefined();
            if (firstDocument !== undefined && firstRecipient !== undefined) {
              expect(jsonBody(createRequest.body)).toMatchObject({
                name: submissionPayload.title,
                send_email: false,
                order: "preserved",
                send_sms: false,
                subject: submissionPayload.subject,
                message: { body: submissionPayload.message },
                documents: [
                  {
                    name: firstDocument.fileName,
                    position: 0,
                    file: sampleContentBase64,
                  },
                ],
                submitters: [
                  {
                    name: firstRecipient.name,
                    email: firstRecipient.email,
                    role: firstRecipient.role,
                    order: firstRecipient.routingOrder,
                  },
                ],
              });
            }
          }
        }),
    ),
  );

  it.effect("maps every local state from get and list, and list follows 2-page pagination", () =>
    withLocalServer(
      async (request, _baseUrl) => {
        if (request.pathname === "/submissions") {
          const after = request.query.get("after");
          const start = after === null ? 0 : Number(after);
          const pageSize = 4;
          const page = STATE_CASES.slice(start, start + pageSize);
          const next = start + page.length >= STATE_CASES.length ? null : start + page.length;

          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              data: page.map((entry) => ({ id: entry.id, status: entry.remoteStatus })),
              pagination: {
                count: STATE_CASES.length,
                next,
                prev: start === 0 ? null : start - pageSize,
              },
            }),
          };
        }

        if (request.pathname.startsWith("/submissions/")) {
          const id = request.pathname.slice("/submissions/".length);
          const selected = STATE_CASES.find((entry) => entry.id === id);
          if (selected === undefined) {
            return { status: 404, body: "not found" };
          }

          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: selected.id,
              status: selected.remoteStatus,
            }),
          };
        }

        return { status: 404, body: "not found" };
      },
      (options, requests) =>
        Effect.gen(function* () {
          const listed = yield* listDocuSealSignatureRequests(options).pipe(
            Effect.provide(docuSealCredentialsLayer(options)),
          );

          const listRequests = requests.filter(
            (request) => request.pathname === "/submissions" && request.method === "GET",
          );
          const firstListRequest = listRequests[0];
          const secondListRequest = listRequests[1];
          expect(firstListRequest).toBeDefined();
          expect(secondListRequest).toBeDefined();
          if (firstListRequest !== undefined && secondListRequest !== undefined) {
            expect(firstListRequest.query.get("after")).toBeNull();
            expect(secondListRequest.query.get("after")).toBe("4");
            expect(firstListRequest.query.get("limit")).toBe("100");
            expect(secondListRequest.query.get("limit")).toBe("100");
          }

          expect(listed).toHaveLength(STATE_CASES.length);
          const listedById = new Map<string, DocuSealSubmissionState>();
          for (const entry of listed) listedById.set(entry.id, entry.state);
          for (const { id, localState } of STATE_CASES) {
            const remoteState = listedById.get(id);
            expect(remoteState).toBeDefined();
            expect(remoteState).toBe(localState);
          }

          for (const { id, localState } of STATE_CASES) {
            const fetched = yield* getDocuSealSignatureRequest(options, id).pipe(
              Effect.provide(docuSealCredentialsLayer(options)),
            );
            expect(fetched.id).toBe(id);
            expect(fetched.state).toBe(localState);
          }

          const getRequests = requests.filter(
            (request) =>
              request.pathname !== "/submissions" &&
              request.pathname.startsWith("/submissions/") &&
              request.method === "GET",
          );
          expect(getRequests).toHaveLength(STATE_CASES.length);
          expect(requests).toHaveLength(2 + STATE_CASES.length);
        }),
    ),
  );

  it.effect("delete treats 404 responses as success", () =>
    withLocalServer(
      async (request, _baseUrl) => {
        if (request.method === "DELETE" && request.pathname === "/submissions/missing") {
          return { status: 404, body: "gone" };
        }
        return { status: 404, body: "not found" };
      },
      (options, requests) =>
        Effect.gen(function* () {
          const result = yield* deleteDocuSealSignatureRequest(options, "missing").pipe(
            Effect.provide(docuSealCredentialsLayer(options)),
          );
          expect(result).toBeUndefined();
          expect(requests).toHaveLength(1);
          const deleteRequest = requests[0];
          expect(deleteRequest).toBeDefined();
          if (deleteRequest !== undefined) {
            expect(deleteRequest.method).toBe("DELETE");
            expect(deleteRequest.pathname).toBe("/submissions/missing");
            expect(deleteRequest.headers["x-auth-token"]).toBe(API_KEY);
          }
        }),
    ),
  );

  it.effect("downloads signed bytes when status is completed", () => {
    const expectedBytes = new TextEncoder().encode("signed bytes from local docuSeal");
    const downloadPath = "/download/completed";

    return withLocalServer(
      async (request, baseUrl) => {
        if (request.pathname === "/submissions/completed") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: "completed",
              status: "completed",
              combined_document_url: `${baseUrl}${downloadPath}`,
            }),
          };
        }

        if (request.pathname === downloadPath) {
          return {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
            body: expectedBytes,
          };
        }

        return { status: 404, body: "not found" };
      },
      (options, requests) =>
        Effect.gen(function* () {
          const downloaded = yield* downloadDocuSealSignedDocument(options, "completed").pipe(
            Effect.provide(docuSealCredentialsLayer(options)),
          );

          expect(downloaded).toEqual(expectedBytes);
          expect(requests).toHaveLength(2);
          expect(
            requests.some(
              (request) =>
                request.pathname === "/submissions/completed" && request.method === "GET",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) => request.pathname === downloadPath && request.method === "GET",
            ),
          ).toBe(true);
        }),
    );
  });

  it.effect("rejects unsigned download with unsupportedOperation and message", () =>
    withLocalServer(
      async (request, _baseUrl) => {
        if (request.pathname === "/submissions/draft") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "draft", status: "draft" }),
          };
        }

        return { status: 404, body: "not found" };
      },
      (options, requests) =>
        Effect.gen(function* () {
          const result = yield* Effect.result(
            downloadDocuSealSignedDocument(options, "draft").pipe(
              Effect.provide(docuSealCredentialsLayer(options)),
            ),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
            expect(result.failure.provider).toBe("docuseal");
            expect(result.failure.reason).toContain("not completed");
            expect(result.failure.reason).toContain("draft");
          }
          expect(requests).toHaveLength(1);
          const getRequest = requests[0];
          expect(getRequest).toBeDefined();
          if (getRequest !== undefined) {
            expect(getRequest.pathname).toBe("/submissions/draft");
            expect(getRequest.method).toBe("GET");
          }
        }),
    ),
  );
});
