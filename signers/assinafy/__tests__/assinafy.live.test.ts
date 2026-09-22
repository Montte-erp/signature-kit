import { createPdfFixture } from "../../../tooling/testing/fixtures";
import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted, Schema } from "effect";
import {
  AssinafySignatureRequest,
  providers as assinafyProviders,
  deleteAssinafySignatureRequest,
  getAssinafySignatureRequest,
  listAssinafySignatureRequests,
} from "../src/index";
import type {
  AssinafySignatureRequestAttributes,
  AssinafyProviderOptions,
  AssinafySignatureRequestProps,
} from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    accountId: requiredEnv("ASSINAFY_ACCOUNT_ID"),
    apiKey: requiredEnv("ASSINAFY_API_KEY"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("ASSINAFY_BASE_URL"),
  }),
);

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

const deleteAssinafyArtifacts = (
  request: AssinafySignatureRequestAttributes,
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
  request: AssinafySignatureRequestProps,
) =>
  Effect.gen(function* () {
    const provider = yield* Provider.findProvider(AssinafySignatureRequest);
    return yield* provider.reconcile(reconcileResourceProps("assinafy-live-request", request));
  }).pipe(Effect.provide(assinafyProviders(options)), Effect.provide(signatureHttpClientLive));

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
                contentBase64: Buffer.from(createPdfFixture()).toString("base64"),
              },
            ],
            recipients: [
              {
                name: "SignatureKit Live Recipient",
                email: recipientEmail,
                routingOrder: 1,
              },
            ],
            send: false,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          } satisfies AssinafySignatureRequestProps;

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
