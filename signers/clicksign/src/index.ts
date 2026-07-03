import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  redactedStringSchema,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpRequest } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const ClicksignSchemaName = {
  providerOptions: "ClicksignProviderOptions",
  signatureRequestProps: "ClicksignSignatureRequestProps",
  documentResult: "ClicksignDocumentResult",
  signerResult: "ClicksignSignerResult",
  listResult: "ClicksignListResult",
  documentsResult: "ClicksignDocumentsResult",
} satisfies Record<string, string>;

const ClicksignOperation = {
  create: "clicksign.create",
  download: "clicksign.download",
} satisfies Record<string, string>;

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const ClicksignProviderId = "clicksign";
const PROVIDER = ClicksignProviderId;

export const ClicksignSignatureRequestStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
export type ClicksignSignatureRequestState = (typeof ClicksignSignatureRequestStateSchema)["Type"];

export const ClicksignDocumentInputSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  content: Schema.Uint8Array,
});
export type ClicksignDocumentInput = (typeof ClicksignDocumentInputSchema)["Type"];

export const ClicksignDocumentPropsSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  contentBase64: base64String,
});
export type ClicksignDocumentProps = (typeof ClicksignDocumentPropsSchema)["Type"];

export const ClicksignSignerRoleSchema = Schema.Literals(["approver", "signer"]);
export type ClicksignSignerRole = (typeof ClicksignSignerRoleSchema)["Type"];

export const ClicksignSignerSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  role: Schema.optional(ClicksignSignerRoleSchema),
  routingOrder: Schema.optional(Schema.Number),
});
export type ClicksignSigner = (typeof ClicksignSignerSchema)["Type"];

export const ClicksignSignatureRequestInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([ClicksignDocumentInputSchema]),
  recipients: Schema.NonEmptyArray(ClicksignSignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type ClicksignSignatureRequestInput = (typeof ClicksignSignatureRequestInputSchema)["Type"];

export const ClicksignSignatureRequestPropsSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([ClicksignDocumentPropsSchema]),
  recipients: Schema.NonEmptyArray(ClicksignSignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type ClicksignSignatureRequestProps = (typeof ClicksignSignatureRequestPropsSchema)["Type"];

export const ClicksignSignatureRequestAttributesSchema = Schema.Struct({
  provider: Schema.Literal(PROVIDER),
  id: Schema.NonEmptyString,
  state: ClicksignSignatureRequestStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type ClicksignSignatureRequestAttributes =
  (typeof ClicksignSignatureRequestAttributesSchema)["Type"];

const clicksignSignatureRequestNoopDiff: { readonly action: "noop" } = { action: "noop" };

const clicksignSignatureRequestDiff = ({
  olds,
}: {
  readonly olds: ClicksignSignatureRequestProps | undefined;
}): Effect.Effect<typeof clicksignSignatureRequestNoopDiff | undefined> =>
  Effect.succeed(olds === undefined ? undefined : clicksignSignatureRequestNoopDiff);

const clicksignSignatureRequestInputFromProps = (
  props: ClicksignSignatureRequestProps,
): ClicksignSignatureRequestInput => {
  const [document] = props.documents;
  return {
    title: props.title,
    documents: [
      {
        fileName: document.fileName,
        mimeType: document.mimeType,
        content: Uint8Array.fromBase64(document.contentBase64),
      },
    ],
    recipients: props.recipients,
    ...(props.message === undefined ? {} : { message: props.message }),
    ...(props.send === undefined ? {} : { send: props.send }),
    ...(props.expiresAt === undefined ? {} : { expiresAt: props.expiresAt }),
    ...(props.redirectUrl === undefined ? {} : { redirectUrl: props.redirectUrl }),
  };
};

const clicksignSignatureRequestInputFromResourceProps = (
  props: unknown,
): Effect.Effect<ClicksignSignatureRequestInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(ClicksignSignatureRequestPropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: ClicksignSchemaName.signatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(clicksignSignatureRequestInputFromProps),
  );

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

const toClicksignSignatureRequestAttributesState = (
  status: string | undefined,
): ClicksignSignatureRequestAttributes["state"] => {
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

const toClicksignSignatureRequestAttributes = (
  baseUrl: string,
  document: ClicksignDocumentInfo,
): ClicksignSignatureRequestAttributes => {
  const downloadUrl = resolveClicksignSignedDocumentUrl(document);
  return {
    provider: PROVIDER,
    id: document.key,
    state: toClicksignSignatureRequestAttributesState(document.status),
    providerStatus: document.status,
    detailsUrl: `${baseUrl}${clicksignDocumentPath(document.key)}`,
    // Clicksign v1 has no /documents/{key}/download endpoint — signed files are
    // only exposed through document.downloads.*_url, so absent means absent.
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
  };
};

const getClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<ClicksignSignatureRequestAttributes, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        ...withAccessToken(baseUrl, clicksignDocumentPath(id), options.accessToken),
        headers: { "Content-Type": "application/json" },
      },
      ClicksignGetDocumentResponseSchema,
      ClicksignSchemaName.documentResult,
    )
    .pipe(Effect.map((result) => toClicksignSignatureRequestAttributes(baseUrl, result.document)));

const listClicksignSignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
): Effect.Effect<ClicksignSignatureRequestAttributes[], SignatureKitError> => {
  const fetchPage = (
    page: number,
  ): Effect.Effect<ClicksignSignatureRequestAttributes[], SignatureKitError> => {
    const pagePath = `/documents?page=${String(page)}`;
    return http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          ...withAccessToken(baseUrl, pagePath, options.accessToken),
        },
        ClicksignDocumentsResultSchema,
        ClicksignSchemaName.documentsResult,
      )
      .pipe(
        Effect.flatMap((result) => {
          const documents = result.documents.map((document) =>
            toClicksignSignatureRequestAttributes(baseUrl, document),
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
    // Clicksign v1 cancels via PATCH /api/v1/documents/{key}/cancel.
    method: "PATCH",
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

const shouldRollbackClicksignCreate = (error: SignatureKitError): boolean =>
  error.code === SignatureKitErrorCodeValue.http &&
  error.status !== undefined &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 429;

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

  if (parsed.searchParams.has("access_token")) {
    const diagnosticUrl = new URL(downloadUrl);
    diagnosticUrl.searchParams.set("access_token", "<redacted>");
    return { url: downloadUrl, diagnosticUrl: diagnosticUrl.toString() };
  }
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
      // No downloads.*_url on the document yet — Clicksign only exposes the
      // signed file once signing finishes; there is no generic download route.
      return Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.unsupportedOperation,
          retryable: false,
          provider: PROVIDER,
          operation: ClicksignOperation.download,
          reason: `Clicksign document ${id} has no signed file to download yet (status: ${request.providerStatus ?? "unknown"}).`,
        }),
      );
    }),
  );
export type ClicksignSignatureRequest = Resource<
  "SignatureKit.ClicksignSignatureRequest",
  ClicksignSignatureRequestProps,
  ClicksignSignatureRequestAttributes
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
            schemaName: ClicksignSchemaName.providerOptions,
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

const documentPath = (document: ClicksignDocumentInput): string =>
  document.fileName.startsWith("/") ? document.fileName : `/${document.fileName}`;

const recipientGroup = (recipient: ClicksignSigner, index: number): number =>
  recipient.routingOrder ?? index + 1;

const createDocument = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: ClicksignSignatureRequestInput,
  document: ClicksignDocumentInput,
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
            // Only serialize signing when the caller asked for an order —
            // multiple recipients without routingOrder sign in parallel, like
            // every other provider.
            sequence_enabled: input.recipients.some(
              (recipient) => recipient.routingOrder !== undefined,
            ),
          },
        }),
      },
      ClicksignDocumentResultSchema,
      ClicksignSchemaName.documentResult,
    )
    .pipe(Effect.map((result) => result.document.key));

const createSigner = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  recipient: ClicksignSigner,
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
      ClicksignSchemaName.signerResult,
    )
    .pipe(Effect.map((result) => result.signer.key));

const linkRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  documentKey: string,
  signerKey: string,
  recipient: ClicksignSigner,
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
      ClicksignSchemaName.listResult,
    )
    .pipe(Effect.map((result) => result.list.request_signature_key));

const notifyRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  requestSignatureKey: string,
  input: ClicksignSignatureRequestInput,
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

const createClicksignSignatureRequest = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: ClicksignSignatureRequestInput,
): Effect.Effect<ClicksignSignatureRequestAttributes, SignatureKitError> => {
  const [document] = input.documents;

  return createDocument(http, options, baseUrl, input, document).pipe(
    Effect.flatMap((documentKey) =>
      Effect.forEach(
        input.recipients,
        (recipient, index) =>
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
        { concurrency: "unbounded" },
      ).pipe(
        Effect.flatMap((requestSignatureKeys) =>
          input.send === false
            ? Effect.succeed({ documentKey })
            : Effect.forEach(
                requestSignatureKeys,
                (requestSignatureKey) =>
                  notifyRecipient(http, options, baseUrl, requestSignatureKey, input),
                { concurrency: "unbounded", discard: true },
              ).pipe(Effect.as({ documentKey })),
        ),
        Effect.catch((error) =>
          shouldRollbackClicksignCreate(error)
            ? deleteClicksignSignatureRequestInternal(http, options, baseUrl, documentKey).pipe(
                Effect.catch(() => Effect.void),
                Effect.flatMap(() => Effect.fail(error)),
              )
            : Effect.fail(error),
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
        diff: clicksignSignatureRequestDiff,
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
          const input = yield* clicksignSignatureRequestInputFromResourceProps(news);
          return yield* createClicksignSignatureRequest(http, options, baseUrl, input);
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
): Effect.Effect<ClicksignSignatureRequestAttributes, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ClicksignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getClicksignSignatureRequestInternal(http, valid, clicksignBaseUrl(valid), id);
  });

export const listClicksignSignatureRequests = (
  options: ClicksignProviderOptions,
): Effect.Effect<
  readonly ClicksignSignatureRequestAttributes[],
  SignatureKitError,
  SignatureHttpClient
> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ClicksignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ClicksignSchemaName.providerOptions,
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
            schemaName: ClicksignSchemaName.providerOptions,
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
            schemaName: ClicksignSchemaName.providerOptions,
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
            schemaName: ClicksignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadClicksignSignedDocumentInternal(http, valid, clicksignBaseUrl(valid), id);
  });
