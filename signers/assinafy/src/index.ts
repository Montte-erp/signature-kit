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
import {
  SignatureHttpClient,
  bearerAuthorization,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpHeaders } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "assinafy";
const ASSINAFY_PROVIDER_COLLECTION_ID = "@signature-kit/assinafy/Providers";
const SANDBOX_BASE_URL = "https://sandbox.assinafy.com.br";
const PRODUCTION_BASE_URL = "https://api.assinafy.com.br";

const AssinafyEnvironmentSchema = Schema.Literals(["production", "sandbox"]);
export type AssinafyEnvironment = (typeof AssinafyEnvironmentSchema)["Type"];

const AssinafyCommonProviderOptionsSchema = {
  accountId: Schema.NonEmptyString,
  environment: Schema.optional(AssinafyEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
};

export const AssinafyProviderOptionsSchema = Schema.Union([
  Schema.Struct({ ...AssinafyCommonProviderOptionsSchema, apiKey: redactedStringSchema }),
  Schema.Struct({ ...AssinafyCommonProviderOptionsSchema, accessToken: redactedStringSchema }),
]);
export type AssinafyProviderOptions = (typeof AssinafyProviderOptionsSchema)["Type"];

const AssinafyDocumentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
});

const AssinafyDocumentResultSchema = Schema.Struct({
  data: AssinafyDocumentSchema,
});

const AssinafySignerResultSchema = Schema.Struct({
  data: Schema.Struct({ id: Schema.NonEmptyString }),
});

const AssinafySigningUrlSchema = Schema.Struct({
  signer_id: Schema.optional(Schema.String),
  url: Schema.NonEmptyString,
});

const AssinafyAssignmentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
  signing_urls: Schema.optional(Schema.Array(AssinafySigningUrlSchema)),
  document_id: Schema.optional(Schema.NonEmptyString),
  document: Schema.optional(AssinafyDocumentSchema),
  document_url: Schema.optional(Schema.NonEmptyString),
  download_url: Schema.optional(Schema.NonEmptyString),
});

const AssinafyAssignmentResultSchema = Schema.Struct({
  data: AssinafyAssignmentSchema,
});

const AssinafyListAssignmentsResultSchema = Schema.Struct({
  data: Schema.Array(AssinafyAssignmentSchema),
});

const AssinafyGetAssignmentsResultSchema = Schema.Union([
  Schema.Struct({
    data: AssinafyAssignmentSchema,
  }),
  Schema.Struct({
    data: Schema.Struct({ assignment: AssinafyAssignmentSchema }),
  }),
  Schema.Struct({
    assignment: AssinafyAssignmentSchema,
  }),
]);

export type AssinafySignatureRequest = Resource<
  "SignatureKit.AssinafySignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const AssinafySignatureRequest = Resource<AssinafySignatureRequest>(
  "SignatureKit.AssinafySignatureRequest",
  { defaultRemovalPolicy: "retain" },
);

export class AssinafyCredentials extends Context.Service<
  AssinafyCredentials,
  AssinafyProviderOptions
>()("@signature-kit/assinafy/Credentials") {}

export const assinafyCredentialsLayer = (
  options: AssinafyProviderOptions,
): Layer.Layer<AssinafyCredentials, SignatureKitError> =>
  Layer.effect(
    AssinafyCredentials,
    Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    ),
  );

const assinafyBaseUrl = (options: AssinafyProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return SANDBOX_BASE_URL;
};

const authHeaders = (options: AssinafyProviderOptions): SignatureHttpHeaders => {
  if ("apiKey" in options) {
    return { "X-Api-Key": Redacted.value(options.apiKey) };
  }
  return { Authorization: bearerAuthorization(options.accessToken) };
};
const assinafyPath = (baseUrl: string, ...pathSegments: readonly string[]): string => {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (pathSegments.length === 0) return normalizedBaseUrl;
  return `${normalizedBaseUrl}/${pathSegments.map(encodeURIComponent).join("/")}`;
};

const isAssinafyRequestHost = (baseUrl: string, requestUrl: string): boolean => {
  if (!URL.canParse(requestUrl, `${baseUrl}/`) || !URL.canParse(baseUrl)) return false;
  return new URL(requestUrl, `${baseUrl}/`).origin === new URL(baseUrl).origin;
};

const assinafyDownloadHeaders = (
  baseUrl: string,
  requestUrl: string,
  options: AssinafyProviderOptions,
): SignatureHttpHeaders | undefined =>
  isAssinafyRequestHost(baseUrl, requestUrl) ? authHeaders(options) : undefined;

const uploadDocument = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  document: RemoteSignatureDocument,
): Effect.Effect<
  { readonly id: string; readonly signingUrl?: string | undefined },
  SignatureKitError
> => {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([Uint8Array.from(document.content)], { type: document.mimeType }),
    document.fileName,
  );
  return http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        url: assinafyPath(baseUrl, "v1", "accounts", options.accountId, "documents"),
        headers: authHeaders(options),
        body: formData,
      },
      AssinafyDocumentResultSchema,
      SignatureKitSchemaNameValue.assinafyDocumentResult,
    )
    .pipe(Effect.map((result) => ({ id: result.data.id, signingUrl: result.data.signing_url })));
};

const createSigner = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  recipient: RemoteSignatureRecipient,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        url: assinafyPath(baseUrl, "v1", "accounts", options.accountId, "signers"),
        headers: { "Content-Type": "application/json", ...authHeaders(options) },
        body: JSON.stringify({
          full_name: recipient.name,
          email: recipient.email,
        }),
      },
      AssinafySignerResultSchema,
      SignatureKitSchemaNameValue.assinafySignerResult,
    )
    .pipe(Effect.map((result) => result.data.id));

const createAssignment = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  documentId: string,
  signerIds: readonly string[],
  input: RemoteSignatureRequestInput,
): Effect.Effect<
  { readonly id: string; readonly signingUrl?: string | undefined },
  SignatureKitError
> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        url: assinafyPath(baseUrl, "v1", "documents", documentId, "assignments"),
        headers: { "Content-Type": "application/json", ...authHeaders(options) },
        body: JSON.stringify({
          method: "virtual",
          signers: signerIds.map((id, index) => ({
            id,
            verification_method: "Email",
            notification_methods: input.send === false ? [] : ["Email"],
            step: index + 1,
          })),
          message: input.message,
          expires_at: input.expiresAt?.toISOString(),
        }),
      },
      AssinafyAssignmentResultSchema,
      SignatureKitSchemaNameValue.assinafyAssignmentResult,
    )
    .pipe(
      Effect.map((result) => ({
        id: result.data.id,
        signingUrl: result.data.signing_urls?.[0]?.url,
      })),
    );
type AssinafyAssignment = (typeof AssinafyAssignmentSchema)["Type"];
type AssinafyListAssignmentsResult = (typeof AssinafyListAssignmentsResultSchema)["Type"];
type AssinafyGetAssignmentsResult = (typeof AssinafyGetAssignmentsResultSchema)["Type"];

const listAssignmentsFromResponse = (
  response: AssinafyListAssignmentsResult,
): readonly AssinafyAssignment[] => response.data;

const assignmentFromResponse = (response: AssinafyGetAssignmentsResult): AssinafyAssignment =>
  "assignment" in response
    ? response.assignment
    : "assignment" in response.data
      ? response.data.assignment
      : response.data;

const assinafyRequestState = (status: string | undefined): RemoteSignatureRequest["state"] => {
  if (status === undefined) return "sent";
  switch (status.toLowerCase()) {
    case "draft":
      return "draft";
    case "completed":
    case "signed":
    case "certificated":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "deleted":
      return "deleted";
    case "declined":
    case "rejected_by_signer":
    case "rejected_by_user":
    case "failed":
      return "declined";
    case "expired":
      return "expired";
    default:
      return "sent";
  }
};

const signingUrlFromAssinafyAssignment = (assignment: AssinafyAssignment): string | undefined =>
  assignment.signing_urls?.[0]?.url ?? assignment.signing_url;

const remoteRequestDetailsUrl = (
  baseUrl: string,
  assignment: AssinafyAssignment,
): string | undefined => {
  if (assignment.document_url !== undefined) return assignment.document_url;
  const documentId = assignment.document?.id ?? assignment.document_id;
  return documentId === undefined
    ? undefined
    : assinafyPath(baseUrl, "v1", "documents", documentId);
};

const toRemoteSignatureRequest = (
  baseUrl: string,
  assignment: AssinafyAssignment,
): RemoteSignatureRequest => ({
  provider: PROVIDER,
  id: assignment.id,
  state: assinafyRequestState(assignment.status ?? assignment.document?.status),
  providerStatus: assignment.status ?? assignment.document?.status,
  signingUrl: signingUrlFromAssinafyAssignment(assignment),
  detailsUrl: remoteRequestDetailsUrl(baseUrl, assignment),
  downloadUrl:
    assignment.download_url ??
    (assignment.document_id === undefined
      ? assignment.document?.id === undefined
        ? undefined
        : assinafyPath(baseUrl, "v1", "documents", assignment.document.id, "download")
      : assinafyPath(baseUrl, "v1", "documents", assignment.document_id, "download")),
});

const getAssinafySignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        url: assinafyPath(baseUrl, "v1", "assignments", id),
        headers: authHeaders(options),
      },
      AssinafyGetAssignmentsResultSchema,
      SignatureKitSchemaNameValue.assinafyAssignmentResult,
    )
    .pipe(
      Effect.map((result) => toRemoteSignatureRequest(baseUrl, assignmentFromResponse(result))),
    );
const listAssinafySignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        url: assinafyPath(baseUrl, "v1", "assignments"),
        headers: authHeaders(options),
      },
      AssinafyListAssignmentsResultSchema,
      SignatureKitSchemaNameValue.assinafyAssignmentsResult,
    )
    .pipe(
      Effect.map((result) =>
        listAssignmentsFromResponse(result).map((assignment) =>
          toRemoteSignatureRequest(baseUrl, assignment),
        ),
      ),
    );

const cancelAssinafySignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    url: assinafyPath(baseUrl, "v1", "assignments", id, "cancel"),
    headers: authHeaders(options),
  });

const deleteAssinafySignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      url: assinafyPath(baseUrl, "v1", "assignments", id),
      headers: authHeaders(options),
    })
    .pipe(
      Effect.catchIf(
        (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
        () => Effect.void,
      ),
    );
const downloadAssinafySignedDocumentInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getAssinafySignatureRequestInternal(http, options, baseUrl, id).pipe(
    Effect.flatMap((request) => {
      const requestBytesFromUrl = (
        downloadUrl: string,
      ): Effect.Effect<Uint8Array, SignatureKitError> => {
        const headers = assinafyDownloadHeaders(baseUrl, downloadUrl, options);
        return headers === undefined
          ? http.requestBytes({
              provider: PROVIDER,
              method: "GET",
              url: downloadUrl,
            })
          : http.requestBytes({
              provider: PROVIDER,
              method: "GET",
              url: downloadUrl,
              headers,
            });
      };
      const signedDocumentUrl = request.downloadUrl;
      if (signedDocumentUrl !== undefined) {
        return requestBytesFromUrl(signedDocumentUrl);
      }
      if (request.detailsUrl === undefined) {
        return requestBytesFromUrl(assinafyPath(baseUrl, "v1", "assignments", id, "download"));
      }
      return requestBytesFromUrl(`${request.detailsUrl}/download`);
    }),
  );

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
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
        reason: "Assinafy creates assignments for one uploaded document at a time.",
      }),
    );
  }

  return uploadDocument(http, options, baseUrl, document).pipe(
    Effect.flatMap((uploadedDocument) =>
      Effect.forEach(input.recipients, (recipient) =>
        createSigner(http, options, baseUrl, recipient),
      ).pipe(
        Effect.flatMap((signerIds) =>
          createAssignment(http, options, baseUrl, uploadedDocument.id, signerIds, input).pipe(
            Effect.map((assignment) => ({ document: uploadedDocument, assignment })),
          ),
        ),
        Effect.mapError(
          (error) =>
            new SignatureKitError({
              code: error.code,
              retryable: false,
              provider: error.provider ?? PROVIDER,
              operation: SignatureKitOperationValue.remoteCreate,
              status: error.status,
              schemaName: error.schemaName,
              issueMessage: error.issueMessage,
              reason:
                error.reason === undefined
                  ? `Assinafy create for document ${uploadedDocument.id} failed after document upload.`
                  : `Assinafy create for document ${uploadedDocument.id} failed after document upload: ${error.reason}`,
            }),
        ),
      ),
    ),
    Effect.map(({ document, assignment }) => ({
      provider: PROVIDER,
      id: assignment.id,
      state: input.send === false ? "draft" : "sent",
      providerStatus: "assignment_created",
      signingUrl: assignment.signingUrl ?? document.signingUrl,
      detailsUrl: `${baseUrl}/v1/documents/${document.id}`,
    })),
  );
};

export const AssinafySignatureRequestProvider = () =>
  Provider.effect(
    AssinafySignatureRequest,
    Effect.gen(function* () {
      const options = yield* AssinafyCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = assinafyBaseUrl(options);

      return AssinafySignatureRequest.Provider.of({
        diff: ({ olds }) => Effect.succeed(olds === undefined ? undefined : { action: "noop" }),
        list: () => listAssinafySignatureRequestsInternal(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : getAssinafySignatureRequestInternal(http, options, baseUrl, output.id).pipe(
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
          deleteAssinafySignatureRequestInternal(http, options, baseUrl, output.id),
      });
    }),
  );

export class AssinafyProviders extends Provider.ProviderCollection<AssinafyProviders>()(
  ASSINAFY_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: AssinafyProviderOptions) =>
  Layer.effect(AssinafyProviders, Provider.collection([AssinafySignatureRequest])).pipe(
    Layer.provide(AssinafySignatureRequestProvider()),
    Layer.provide(assinafyCredentialsLayer(options)),
  );

export const getAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getAssinafySignatureRequestInternal(http, valid, assinafyBaseUrl(valid), id);
  });

export const listAssinafySignatureRequests = (
  options: AssinafyProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listAssinafySignatureRequestsInternal(http, valid, assinafyBaseUrl(valid));
  });

export const cancelAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* cancelAssinafySignatureRequestInternal(http, valid, assinafyBaseUrl(valid), id);
  });

export const deleteAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* deleteAssinafySignatureRequestInternal(http, valid, assinafyBaseUrl(valid), id);
  });

export const downloadAssinafySignedDocument = (
  options: AssinafyProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadAssinafySignedDocumentInternal(http, valid, assinafyBaseUrl(valid), id);
  });
