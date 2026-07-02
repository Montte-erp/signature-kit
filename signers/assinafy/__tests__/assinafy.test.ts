import { describe, expect, it } from "@effect/vitest";
import type {
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
} from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Schema } from "effect";
import {
  AssinafySignatureRequest,
  AssinafySignatureRequestProvider,
  assinafyCredentialsLayer,
  deleteAssinafySignatureRequest,
  getAssinafySignatureRequest,
  listAssinafySignatureRequests,
  type AssinafyProviderOptions,
} from "../src/index";

// Real end-to-end coverage against the Assinafy sandbox. There are no mocks:
// every call in the "live" branch hits https://sandbox.assinafy.com.br with the
// account credentials loaded by tooling/vitest/load-env.ts. Run with
//   SIGNATURE_KIT_LIVE_REMOTE_SIGNERS=1 bunx vitest run signers/assinafy/__tests__/assinafy.test.ts
// Without the flag (or credentials) the suite reports a clean skip.
const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const accountId = process.env.ASSINAFY_ACCOUNT_ID;
  const apiKey = process.env.ASSINAFY_API_KEY;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (accountId === undefined || apiKey === undefined || recipientEmail === undefined) {
    return undefined;
  }

  return {
    accountId,
    apiKey,
    recipientEmail,
    baseUrl: process.env.ASSINAFY_BASE_URL,
  };
};

const livePdf = (): Uint8Array => {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = encoder.encode(pdf).byteLength;
    pdf += object;
    return offset;
  });
  const xrefOffset = encoder.encode(pdf).byteLength;
  const entries = offsets
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  return encoder.encode(
    `${pdf}xref\n0 5\n0000000000 65535 f \n${entries}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
};

// Assinafy's real resource is the uploaded document; the account-scoped list is
// a flat array with page/per_page query support but no pagination metadata.
const AssinafyDocumentResourceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  assignment: Schema.optional(
    Schema.Struct({
      id: Schema.NonEmptyString,
      status: Schema.optional(Schema.String),
    }),
  ),
});
const AssinafyDocumentResultSchema = Schema.Struct({ data: AssinafyDocumentResourceSchema });
const AssinafyDocumentsListSchema = Schema.Struct({
  data: Schema.Array(AssinafyDocumentResourceSchema),
});
const AssinafySignerListSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, email: Schema.String })),
});

const ASSINAFY_CLEANUP_DELETE_ATTEMPTS = 30;
const DOCUMENTS_PER_PAGE = 25;
const MAX_DOCUMENT_PAGES = 40;

const cleanupResponse = (operation: string, response: Response): Effect.Effect<void> => {
  if (response.ok || response.status === 404) return Effect.void;
  return Effect.promise(() => response.text()).pipe(
    Effect.flatMap((body) =>
      Effect.die(`${operation} failed with HTTP ${response.status}: ${body.slice(0, 512)}`),
    ),
  );
};

const readJson = (operation: string, url: string, apiKey: string): Effect.Effect<unknown> =>
  Effect.promise(() => fetch(url, { headers: { "X-Api-Key": apiKey } })).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.promise(() => response.json())
        : Effect.promise(() => response.text()).pipe(
            Effect.flatMap((body) =>
              Effect.die(`${operation} failed with HTTP ${response.status}: ${body.slice(0, 512)}`),
            ),
          ),
    ),
  );

const deleteAssinafyDocument = (
  documentUrl: string,
  apiKey: string,
  attempt: number,
): Effect.Effect<void> =>
  Effect.promise(() =>
    fetch(documentUrl, { method: "DELETE", headers: { "X-Api-Key": apiKey } }),
  ).pipe(
    Effect.flatMap((response) => {
      if (response.ok || response.status === 404) return Effect.void;
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((body) => {
          // A freshly uploaded document is briefly locked while Assinafy
          // extracts metadata; retry the delete until it releases.
          if (
            response.status === 400 &&
            body.includes("metadata_processing") &&
            attempt < ASSINAFY_CLEANUP_DELETE_ATTEMPTS
          ) {
            return Effect.promise<void>(
              () => new Promise((resolve) => setTimeout(resolve, 2000)),
            ).pipe(Effect.flatMap(() => deleteAssinafyDocument(documentUrl, apiKey, attempt + 1)));
          }
          return Effect.die(
            `Delete Assinafy document failed with HTTP ${response.status}: ${body.slice(0, 512)}`,
          );
        }),
      );
    }),
  );

const liveRecipientEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, at)}+signature-kit-${Date.now()}${email.slice(at)}`;
};

// Cleanup deletes exactly what this run created. Idempotent: provider delete and
// direct document delete both accept already-deleted documents, and re-runs create
// fresh unique signer emails so signer cleanup only targets this run's recipient.
const deleteAssinafyArtifacts = (
  request: RemoteSignatureRequest,
  options: { readonly accountId: string; readonly apiKey: string; readonly recipientEmail: string },
) => {
  const documentUrl = request.detailsUrl;
  if (documentUrl === undefined) {
    return Effect.die("Assinafy live cleanup requires the created document URL.");
  }
  const baseUrl = new URL(documentUrl).origin;

  return Effect.gen(function* () {
    yield* deleteAssinafyDocument(documentUrl, options.apiKey, 1);

    const signersBody = yield* readJson(
      "List Assinafy signers",
      `${baseUrl}/v1/accounts/${options.accountId}/signers?email=${encodeURIComponent(options.recipientEmail)}`,
      options.apiKey,
    );
    const signers = yield* Schema.decodeUnknownEffect(AssinafySignerListSchema)(signersBody).pipe(
      Effect.orDie,
    );

    yield* Effect.forEach(
      signers.data.filter((signer) => signer.email === options.recipientEmail),
      (signer) =>
        Effect.promise(() =>
          fetch(`${baseUrl}/v1/accounts/${options.accountId}/signers/${signer.id}`, {
            method: "DELETE",
            headers: { "X-Api-Key": options.apiKey },
          }),
        ).pipe(Effect.flatMap((response) => cleanupResponse("Delete Assinafy signer", response))),
      { discard: true },
    );
  });
};

// Pages the account-scoped documents list (page/per_page) until it locates the
// created document or exhausts the pages. This exercises real pagination: the
// account accumulates documents across runs, so the created id may not sit on
// page 1.
const findCreatedDocumentAcrossPages = (
  baseUrl: string,
  accountId: string,
  apiKey: string,
  documentId: string,
  page: number,
): Effect.Effect<boolean> =>
  readJson(
    "List Assinafy documents",
    `${baseUrl}/v1/accounts/${accountId}/documents?page=${page}&per_page=${DOCUMENTS_PER_PAGE}`,
    apiKey,
  ).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(AssinafyDocumentsListSchema)(body).pipe(Effect.orDie),
    ),
    Effect.flatMap((list) => {
      if (list.data.some((document) => document.id === documentId)) return Effect.succeed(true);
      if (list.data.length < DOCUMENTS_PER_PAGE || page >= MAX_DOCUMENT_PAGES) {
        return Effect.succeed(false);
      }
      return findCreatedDocumentAcrossPages(baseUrl, accountId, apiKey, documentId, page + 1);
    }),
  );

const reconcileAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* AssinafySignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("assinafy-live-request", request));
  }).pipe(
    Effect.provide(AssinafySignatureRequestProvider()),
    Effect.provide(assinafyCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

const config = liveConfig();

if (config === undefined) {
  describe.skip("Assinafy live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, ASSINAFY_ACCOUNT_ID, ASSINAFY_API_KEY and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const activeConfig = config;

  describe("Assinafy live API", () => {
    it.effect(
      "creates a draft, resolves it against the real document API, and deletes what it created",
      () =>
        Effect.gen(function* () {
          const recipientEmail = liveRecipientEmail(activeConfig.recipientEmail);
          const providerOptions: AssinafyProviderOptions = {
            accountId: activeConfig.accountId,
            apiKey: Redacted.make(activeConfig.apiKey),
            environment: "sandbox",
            ...(activeConfig.baseUrl === undefined ? {} : { baseUrl: activeConfig.baseUrl }),
          };
          const input = {
            title: "SignatureKit live Assinafy assignment",
            message: "Created by SignatureKit live test.",
            documents: [
              {
                fileName: "signature-kit-live.pdf",
                mimeType: "application/pdf",
                content: livePdf(),
              },
            ],
            recipients: [
              {
                name: "SignatureKit Live Recipient",
                email: recipientEmail,
                role: "signer",
                routingOrder: 1,
              },
            ],
            send: false,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          } satisfies RemoteSignatureRequestInput;

          // 1. create (draft): real multi-step upload -> signer -> assignment.
          const request = yield* reconcileAssinafySignatureRequest(providerOptions, input);

          yield* Effect.gen(function* () {
            expect(request.provider).toBe("assinafy");
            expect(request.id.length).toBeGreaterThan(0);
            expect(request.detailsUrl).toBeDefined();

            const documentUrl = request.detailsUrl;
            if (documentUrl === undefined) {
              return yield* Effect.die("Assinafy create must expose the document detailsUrl.");
            }
            const baseUrl = new URL(documentUrl).origin;
            expect(documentUrl).toBe(`${baseUrl}/v1/documents/${request.id}`);

            // 2. get by document id: the provider maps the real document resource
            // and its embedded assignment into RemoteSignatureRequest.
            const fetched = yield* getAssinafySignatureRequest(providerOptions, request.id).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(fetched.id).toBe(request.id);
            expect(fetched.provider).toBe("assinafy");
            expect(fetched.detailsUrl).toBe(documentUrl);
            expect(fetched.signingUrl).toBeDefined();

            const documentBody = yield* readJson(
              "Get Assinafy document",
              documentUrl,
              activeConfig.apiKey,
            );
            const document = yield* Schema.decodeUnknownEffect(AssinafyDocumentResultSchema)(
              documentBody,
            ).pipe(Effect.orDie);
            expect(document.data.id).toBe(request.id);
            expect(document.data.assignment?.id.length).toBeGreaterThan(0);

            // 3. list + pagination: the provider pages the real account-scoped
            // document list until Assinafy returns a short page.
            const listed = yield* listAssinafySignatureRequests(providerOptions).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.map((listedRequest) => listedRequest.id)).toContain(request.id);

            const found = yield* findCreatedDocumentAcrossPages(
              baseUrl,
              activeConfig.accountId,
              activeConfig.apiKey,
              request.id,
              1,
            );
            expect(found).toBe(true);

            // 4. delete by document id: the real deletable resource is the
            // document. The ensuring cleanup below repeats deletion safely.
            const deleteResult = yield* deleteAssinafySignatureRequest(
              providerOptions,
              request.id,
            ).pipe(Effect.provide(signatureHttpClientLive));
            expect(deleteResult).toBeUndefined();
          }).pipe(
            Effect.ensuring(
              deleteAssinafyArtifacts(request, {
                accountId: activeConfig.accountId,
                apiKey: activeConfig.apiKey,
                recipientEmail,
              }),
            ),
          );
        }),
      180_000,
    );
  });
}
