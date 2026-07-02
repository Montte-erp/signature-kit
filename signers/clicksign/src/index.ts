import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  redactedStringSchema,
  remoteSignatureInputFromResourceProps,
} from "@signature-kit/core/config";
import type {
  RemoteSignatureDocument,
  RemoteSignatureProvider,
  RemoteSignatureRecipient,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpRequest } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "clicksign";
const CLICKSIGN_PROVIDER_COLLECTION_ID = "@signature-kit/clicksign/Providers";
const SANDBOX_BASE_URL = "https://sandbox.clicksign.com/api/v1";
const PRODUCTION_BASE_URL = "https://app.clicksign.com/api/v1";

const ClicksignEnvironmentSchema = Schema.Literals(["production", "sandbox"]);
export type ClicksignEnvironment = (typeof ClicksignEnvironmentSchema)["Type"];

const ClicksignLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export type ClicksignLocale = (typeof ClicksignLocaleSchema)["Type"];

export const ClicksignProviderOptionsSchema = Schema.Struct({
  accessToken: redactedStringSchema,
  environment: Schema.optional(ClicksignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ClicksignLocaleSchema),
  autoClose: Schema.optional(Schema.Boolean),
});
export type ClicksignProviderOptions = (typeof ClicksignProviderOptionsSchema)["Type"];

const ClicksignDocumentDownloadsSchema = Schema.Struct({
  signed_file_url: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
});

const ClicksignDocumentSchema = Schema.Struct({
  key: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  download_url: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  downloadUrl: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  downloads: Schema.optional(ClicksignDocumentDownloadsSchema),
});

const ClicksignDocumentResultSchema = Schema.Struct({
  document: ClicksignDocumentSchema,
});

const ClicksignSignerResultSchema = Schema.Struct({
  signer: Schema.Struct({ key: Schema.NonEmptyString }),
});

const ClicksignListResultSchema = Schema.Struct({
  list: Schema.Struct({ request_signature_key: Schema.NonEmptyString }),
});

const ClicksignGetDocumentResponseSchema = Schema.Struct({
  document: ClicksignDocumentSchema,
});

const ClicksignPageInfosSchema = Schema.Struct({
  total_pages: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  current_page: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  next_page: Schema.optional(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
  last_page: Schema.optional(Schema.Boolean),
});

const ClicksignDocumentsResultSchema = Schema.Struct({
  documents: Schema.Array(ClicksignDocumentSchema),
  page_infos: Schema.optional(ClicksignPageInfosSchema),
});

type ClicksignDocumentInfo = (typeof ClicksignDocumentSchema)["Type"];
type ClicksignPageInfos = (typeof ClicksignPageInfosSchema)["Type"];

const clicksignPathId = (id: string): string => encodeURIComponent(id);

const clicksignDocumentPath = (id: string): string => `/documents/${clicksignPathId(id)}`;

const clicksignDocumentDownloadPath = (id: string): string =>
  `${clicksignDocumentPath(id)}/download`;

const toRemoteSignatureRequestState = (
  status: string | undefined,
): RemoteSignatureRequest["state"] => {
  if (status === undefined) return "sent";
  switch (status.toLowerCase()) {
    case "draft":
      return "draft";
    case "completed":
    case "signed":
    case "closed":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "deleted":
      return "deleted";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    default:
      return "sent";
  }
};

const resolveClicksignSignedDocumentUrl = (document: ClicksignDocumentInfo): string | undefined => {
  const signedFile = document.downloads?.signed_file_url;
  if (typeof signedFile === "string" && signedFile.length > 0) return signedFile;
  if (typeof document.download_url === "string" && document.download_url.length > 0)
    return document.download_url;
  if (typeof document.downloadUrl === "string" && document.downloadUrl.length > 0)
    return document.downloadUrl;
  return undefined;
};

const parseClicksignPageNumber = (
  value: string | number | null | undefined,
): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
};

const clicksignListNextPage = (
  pageInfos: ClicksignPageInfos | undefined,
  currentPage: number,
): number | undefined => {
  if (pageInfos === undefined) return;
  const nextPage = parseClicksignPageNumber(pageInfos.next_page);
  if (nextPage !== undefined && nextPage > currentPage) return nextPage;
  if (pageInfos.last_page === true) return undefined;
  if (pageInfos.last_page === false) return currentPage + 1;
  const totalPages = parseClicksignPageNumber(pageInfos.total_pages);
  return totalPages === undefined || totalPages <= currentPage ? undefined : currentPage + 1;
};

const toRemoteSignatureRequest = (
  baseUrl: string,
  document: ClicksignDocumentInfo,
): RemoteSignatureRequest => {
  const downloadUrl = resolveClicksignSignedDocumentUrl(document);
  return {
    provider: PROVIDER,
    id: document.key,
    state: toRemoteSignatureRequestState(document.status),
    providerStatus: document.status,
    detailsUrl: `${baseUrl}${clicksignDocumentPath(document.key)}`,
    downloadUrl: downloadUrl ?? `${baseUrl}${clicksignDocumentDownloadPath(document.key)}`,
  };
};

const getClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        ...withAccessToken(baseUrl, clicksignDocumentPath(id), options.accessToken),
        headers: { "Content-Type": "application/json" },
      },
      ClicksignGetDocumentResponseSchema,
      SignatureKitSchemaNameValue.clicksignDocumentResult,
    )
    .pipe(Effect.map((result) => toRemoteSignatureRequest(baseUrl, result.document)));

const listClicksignSignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> => {
  const fetchPage = (page: number): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> => {
    const pagePath = `/documents?page=${String(page)}`;
    return http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          ...withAccessToken(baseUrl, pagePath, options.accessToken),
        },
        ClicksignDocumentsResultSchema,
        SignatureKitSchemaNameValue.clicksignDocumentsResult,
      )
      .pipe(
        Effect.flatMap((result) => {
          const documents = result.documents.map((document) =>
            toRemoteSignatureRequest(baseUrl, document),
          );
          const nextPage = clicksignListNextPage(result.page_infos, page);
          if (nextPage === undefined) return Effect.succeed(documents);
          return fetchPage(nextPage).pipe(
            Effect.map((nextDocuments) => [...documents, ...nextDocuments]),
          );
        }),
      );
  };

  return fetchPage(1);
};

const cancelClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    ...withAccessToken(baseUrl, `${clicksignDocumentPath(id)}/cancel`, options.accessToken),
  });

const deleteClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      ...withAccessToken(baseUrl, clicksignDocumentPath(id), options.accessToken),
    })
    .pipe(
      Effect.catchIf(
        (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
        () => Effect.void,
      ),
    );

const isAbsoluteHttpUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

const clicksignDownloadPath = (path: string): string => (path.startsWith("/") ? path : `/${path}`);

const isClicksignDownloadHost = (baseUrl: string, downloadUrl: string): boolean => {
  if (!URL.canParse(downloadUrl) || !URL.canParse(baseUrl)) return false;
  return new URL(downloadUrl).host === new URL(baseUrl).host;
};

const clicksignDownloadTarget = (
  baseUrl: string,
  downloadUrl: string,
  accessToken: Redacted.Redacted<string>,
): Pick<SignatureHttpRequest, "url" | "diagnosticUrl"> => {
  if (!isAbsoluteHttpUrl(downloadUrl)) {
    return withAccessToken(baseUrl, clicksignDownloadPath(downloadUrl), accessToken);
  }
  if (!isClicksignDownloadHost(baseUrl, downloadUrl)) return { url: downloadUrl };

  const parsed = new URL(downloadUrl);
  if (parsed.searchParams.has("access_token"))
    return { url: downloadUrl, diagnosticUrl: downloadUrl };
  const targetUrl = new URL(downloadUrl);
  const diagnosticUrl = new URL(downloadUrl);
  targetUrl.searchParams.set("access_token", Redacted.value(accessToken));
  diagnosticUrl.searchParams.set("access_token", "<redacted>");
  return { url: targetUrl.toString(), diagnosticUrl: diagnosticUrl.toString() };
};

const downloadClicksignSignedDocumentInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getClicksignSignatureRequestInternal(http, options, baseUrl, id).pipe(
    Effect.flatMap((request) => {
      const signedDocumentUrl = request.downloadUrl;
      if (signedDocumentUrl !== undefined) {
        return http.requestBytes({
          provider: PROVIDER,
          method: "GET",
          ...clicksignDownloadTarget(baseUrl, signedDocumentUrl, options.accessToken),
        });
      }
      return http.requestBytes({
        provider: PROVIDER,
        method: "GET",
        ...withAccessToken(baseUrl, clicksignDocumentDownloadPath(id), options.accessToken),
      });
    }),
  );
export type ClicksignSignatureRequest = Resource<
  "SignatureKit.ClicksignSignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const ClicksignSignatureRequest = Resource<ClicksignSignatureRequest>(
  "SignatureKit.ClicksignSignatureRequest",
  { defaultRemovalPolicy: "retain" },
);

export class ClicksignCredentials extends Context.Service<
  ClicksignCredentials,
  ClicksignProviderOptions
>()("@signature-kit/clicksign/Credentials") {}

export const clicksignCredentialsLayer = (
  options: ClicksignProviderOptions,
): Layer.Layer<ClicksignCredentials, SignatureKitError> =>
  Layer.effect(
    ClicksignCredentials,
    Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    ),
  );

const clicksignBaseUrl = (options: ClicksignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return SANDBOX_BASE_URL;
};

const withAccessToken = (
  baseUrl: string,
  path: string,
  token: Redacted.Redacted<string>,
): Pick<SignatureHttpRequest, "diagnosticUrl" | "url"> => {
  const url = new URL(`${baseUrl}${path}`);
  const diagnosticUrl = new URL(`${baseUrl}${path}`);
  url.searchParams.set("access_token", Redacted.value(token));
  diagnosticUrl.searchParams.set("access_token", "<redacted>");
  return { url: url.toString(), diagnosticUrl: diagnosticUrl.toString() };
};

const documentPath = (document: RemoteSignatureDocument): string =>
  document.fileName.startsWith("/") ? document.fileName : `/${document.fileName}`;

const recipientGroup = (recipient: RemoteSignatureRecipient, index: number): number =>
  recipient.routingOrder ?? index + 1;

const createDocument = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
  document: RemoteSignatureDocument,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        ...withAccessToken(baseUrl, "/documents", options.accessToken),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: {
            path: documentPath(document),
            content_base64: `data:${document.mimeType};base64,${bytesToBase64(document.content)}`,
            deadline_at: input.expiresAt?.toISOString(),
            auto_close: options.autoClose ?? true,
            locale: options.locale ?? "pt-BR",
            sequence_enabled:
              input.recipients.length > 1 ||
              input.recipients.some((recipient) => recipient.routingOrder !== undefined),
          },
        }),
      },
      ClicksignDocumentResultSchema,
      SignatureKitSchemaNameValue.clicksignDocumentResult,
    )
    .pipe(Effect.map((result) => result.document.key));

const createSigner = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  recipient: RemoteSignatureRecipient,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        ...withAccessToken(baseUrl, "/signers", options.accessToken),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer: {
            email: recipient.email,
            name: recipient.name,
            auths: ["email"],
            has_documentation: false,
          },
        }),
      },
      ClicksignSignerResultSchema,
      SignatureKitSchemaNameValue.clicksignSignerResult,
    )
    .pipe(Effect.map((result) => result.signer.key));

const linkRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  documentKey: string,
  signerKey: string,
  recipient: RemoteSignatureRecipient,
  index: number,
  message: string | undefined,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        ...withAccessToken(baseUrl, "/lists", options.accessToken),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list: {
            document_key: documentKey,
            signer_key: signerKey,
            sign_as: recipient.role === "approver" ? "approve" : "sign",
            group: recipientGroup(recipient, index),
            message,
          },
        }),
      },
      ClicksignListResultSchema,
      SignatureKitSchemaNameValue.clicksignListResult,
    )
    .pipe(Effect.map((result) => result.list.request_signature_key));

const notifyRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  requestSignatureKey: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    ...withAccessToken(baseUrl, "/notifications", options.accessToken),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_signature_key: requestSignatureKey,
      message: input.message,
      url: input.redirectUrl,
    }),
  });

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length !== 1 || document === undefined) {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.unsupportedOperation,
        retryable: false,
        provider: PROVIDER,
        operation: SignatureKitOperationValue.remoteCreate,
        reason: "Clicksign API v1 supports one uploaded document per signature request.",
      }),
    );
  }

  return createDocument(http, options, baseUrl, input, document).pipe(
    Effect.flatMap((documentKey) =>
      Effect.forEach(input.recipients, (recipient, index) =>
        createSigner(http, options, baseUrl, recipient).pipe(
          Effect.flatMap((signerKey) =>
            linkRecipient(
              http,
              options,
              baseUrl,
              documentKey,
              signerKey,
              recipient,
              index,
              input.message,
            ),
          ),
        ),
      ).pipe(
        Effect.flatMap((requestSignatureKeys) =>
          input.send === false
            ? Effect.succeed({ documentKey })
            : Effect.forEach(
                requestSignatureKeys,
                (requestSignatureKey) =>
                  notifyRecipient(http, options, baseUrl, requestSignatureKey, input),
                { discard: true },
              ).pipe(Effect.as({ documentKey })),
        ),
        Effect.catch((error) =>
          deleteClicksignSignatureRequestInternal(http, options, baseUrl, documentKey).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
        Effect.mapError(
          (error) =>
            new SignatureKitError({
              code: error.code,
              retryable: error.retryable,
              provider: error.provider ?? PROVIDER,
              operation: SignatureKitOperationValue.remoteCreate,
              status: error.status,
              schemaName: error.schemaName,
              issueMessage: error.issueMessage,
              reason:
                error.reason === undefined
                  ? `Clicksign create for document ${documentKey} failed after document creation.`
                  : `Clicksign create for document ${documentKey} failed after document creation: ${error.reason}`,
            }),
        ),
      ),
    ),
    Effect.map(({ documentKey }) => ({
      provider: PROVIDER,
      id: documentKey,
      state: input.send === false ? "draft" : "sent",
    })),
  );
};

export const ClicksignSignatureRequestProvider = () =>
  Provider.effect(
    ClicksignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ClicksignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = clicksignBaseUrl(options);

      return ClicksignSignatureRequest.Provider.of({
        diff: ({ olds }) => Effect.succeed(olds === undefined ? undefined : { action: "noop" }),
        list: () => listClicksignSignatureRequestsInternal(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : getClicksignSignatureRequestInternal(http, options, baseUrl, output.id).pipe(
                Effect.catchIf(
                  (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
                  () => Effect.succeed(undefined),
                ),
              ),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const input = yield* remoteSignatureInputFromResourceProps(PROVIDER, news);
          return yield* createRemoteRequest(http, options, baseUrl, input);
        }),
        delete: ({ output }) =>
          deleteClicksignSignatureRequestInternal(http, options, baseUrl, output.id),
      });
    }),
  );

export class ClicksignProviders extends Provider.ProviderCollection<ClicksignProviders>()(
  CLICKSIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: ClicksignProviderOptions) =>
  Layer.effect(ClicksignProviders, Provider.collection([ClicksignSignatureRequest])).pipe(
    Layer.provide(ClicksignSignatureRequestProvider()),
    Layer.provide(clicksignCredentialsLayer(options)),
  );

export const getClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getClicksignSignatureRequestInternal(http, valid, clicksignBaseUrl(valid), id);
  });

export const listClicksignSignatureRequests = (
  options: ClicksignProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listClicksignSignatureRequestsInternal(http, valid, clicksignBaseUrl(valid));
  });

export const cancelClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* cancelClicksignSignatureRequestInternal(http, valid, clicksignBaseUrl(valid), id);
  });

export const deleteClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* deleteClicksignSignatureRequestInternal(http, valid, clicksignBaseUrl(valid), id);
  });

export const downloadClicksignSignedDocument = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.clicksignProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadClicksignSignedDocumentInternal(http, valid, clicksignBaseUrl(valid), id);
  });
