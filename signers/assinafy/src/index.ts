import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  redactedStringSchema,
} from "@signature-kit/core/config";
import {
  SignatureHttpClient,
  bearerAuthorization,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpHeaders } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect";

const AssinafySchemaName = {
  providerOptions: "AssinafyProviderOptions",
  signatureRequestProps: "AssinafySignatureRequestProps",
  documentResult: "AssinafyDocumentResult",
  signerResult: "AssinafySignerResult",
  assignmentResult: "AssinafyAssignmentResult",
  documentsResult: "AssinafyDocumentsResult",
} satisfies Record<string, string>;

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const AssinafyProviderId = "assinafy";
const PROVIDER = AssinafyProviderId;

export const AssinafySignatureRequestStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
export type AssinafySignatureRequestState = (typeof AssinafySignatureRequestStateSchema)["Type"];

export const AssinafyDocumentUploadSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  content: Schema.Uint8Array,
});
export type AssinafyDocumentUpload = (typeof AssinafyDocumentUploadSchema)["Type"];

export const AssinafyDocumentUploadPropsSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  contentBase64: base64String,
});
export type AssinafyDocumentUploadProps = (typeof AssinafyDocumentUploadPropsSchema)["Type"];

export const AssinafySignerSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  routingOrder: Schema.optional(Schema.Number),
});
export type AssinafySigner = (typeof AssinafySignerSchema)["Type"];

export const AssinafySignatureRequestInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([AssinafyDocumentUploadSchema]),
  recipients: Schema.NonEmptyArray(AssinafySignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type AssinafySignatureRequestInput = (typeof AssinafySignatureRequestInputSchema)["Type"];

export const AssinafySignatureRequestPropsSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([AssinafyDocumentUploadPropsSchema]),
  recipients: Schema.NonEmptyArray(AssinafySignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type AssinafySignatureRequestProps = (typeof AssinafySignatureRequestPropsSchema)["Type"];

export const AssinafySignatureRequestAttributesSchema = Schema.Struct({
  provider: Schema.Literal(PROVIDER),
  id: Schema.NonEmptyString,
  state: AssinafySignatureRequestStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type AssinafySignatureRequestAttributes =
  (typeof AssinafySignatureRequestAttributesSchema)["Type"];

const assinafySignatureRequestNoopDiff: { readonly action: "noop" } = { action: "noop" };

const assinafySignatureRequestDiff = ({
  olds,
}: {
  readonly olds: AssinafySignatureRequestProps | undefined;
}): Effect.Effect<typeof assinafySignatureRequestNoopDiff | undefined> =>
  Effect.succeed(olds === undefined ? undefined : assinafySignatureRequestNoopDiff);

const assinafySignatureRequestInputFromProps = (
  props: AssinafySignatureRequestProps,
): AssinafySignatureRequestInput => {
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

const assinafySignatureRequestInputFromResourceProps = (
  props: unknown,
): Effect.Effect<AssinafySignatureRequestInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(AssinafySignatureRequestPropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: AssinafySchemaName.signatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(assinafySignatureRequestInputFromProps),
  );

const ASSINAFY_PROVIDER_COLLECTION_ID = "@signature-kit/assinafy/Providers";
const SANDBOX_BASE_URL = "https://sandbox.assinafy.com.br";
const PRODUCTION_BASE_URL = "https://api.assinafy.com.br";
const ASSINAFY_LIST_FIRST_PAGE = 1;
const ASSINAFY_LIST_PER_PAGE = 100;

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

const AssinafySigningUrlSchema = Schema.Struct({
  signer_id: Schema.optional(Schema.String),
  url: Schema.NonEmptyString,
});

const AssinafyAssignmentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
  signing_urls: Schema.optional(Schema.Array(AssinafySigningUrlSchema)),
});

const AssinafyDocumentArtifactsSchema = Schema.Struct({
  original: Schema.optional(Schema.NonEmptyString),
  thumbnail: Schema.optional(Schema.NonEmptyString),
  certificated: Schema.optional(Schema.NonEmptyString),
});

const AssinafyDocumentSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
  artifacts: Schema.optional(AssinafyDocumentArtifactsSchema),
  assignment: Schema.optional(Schema.NullOr(AssinafyAssignmentSchema)),
});

const AssinafyDocumentResultSchema = Schema.Struct({
  data: AssinafyDocumentSchema,
});

const AssinafySignerResultSchema = Schema.Struct({
  data: Schema.Struct({ id: Schema.NonEmptyString }),
});

const AssinafyAssignmentResultSchema = Schema.Struct({
  data: AssinafyAssignmentSchema,
});

const AssinafyDocumentsResultSchema = Schema.Struct({
  data: Schema.Array(AssinafyDocumentSchema),
});

export type AssinafySignatureRequest = Resource<
  "SignatureKit.AssinafySignatureRequest",
  AssinafySignatureRequestProps,
  AssinafySignatureRequestAttributes
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
            schemaName: AssinafySchemaName.providerOptions,
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
  document: AssinafyDocumentUpload,
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
      AssinafySchemaName.documentResult,
    )
    .pipe(Effect.map((result) => ({ id: result.data.id, signingUrl: result.data.signing_url })));
};

const createSigner = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  recipient: AssinafySigner,
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
      AssinafySchemaName.signerResult,
    )
    .pipe(Effect.map((result) => result.data.id));

const createAssignment = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  documentId: string,
  signerIds: readonly string[],
  input: AssinafySignatureRequestInput,
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
            // Honor the caller's routing order like every other provider;
            // fall back to listed order when none was given.
            step: input.recipients[index]?.routingOrder ?? index + 1,
          })),
          message: input.message,
          expires_at: input.expiresAt?.toISOString(),
        }),
      },
      AssinafyAssignmentResultSchema,
      AssinafySchemaName.assignmentResult,
    )
    .pipe(
      Effect.map((result) => ({
        id: result.data.id,
        signingUrl: result.data.signing_urls?.[0]?.url ?? result.data.signing_url,
      })),
    );

type AssinafyDocument = (typeof AssinafyDocumentSchema)["Type"];

const assinafyRequestState = (
  document: AssinafyDocument,
): AssinafySignatureRequestAttributes["state"] => {
  const status = document.status;
  switch (status) {
    case "uploaded":
    case "metadata_processing":
    case "metadata_ready":
      return document.assignment === undefined || document.assignment === null ? "draft" : "sent";
    case "pending_signature":
    case "sent":
    case "waiting_signature":
    case "in_progress":
      return "sent";
    case "completed":
    case "signed":
    case "certificated":
    case "closed":
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
      return document.assignment === undefined || document.assignment === null ? "draft" : "sent";
  }
};

const toAssinafySignatureRequestAttributes = (
  baseUrl: string,
  document: AssinafyDocument,
): AssinafySignatureRequestAttributes => ({
  provider: PROVIDER,
  id: document.id,
  state: assinafyRequestState(document),
  providerStatus: document.status ?? document.assignment?.status,
  signingUrl:
    document.assignment?.signing_urls?.[0]?.url ??
    document.assignment?.signing_url ??
    document.signing_url,
  detailsUrl: assinafyPath(baseUrl, "v1", "documents", document.id),
  downloadUrl: document.artifacts?.certificated,
});

const getAssinafySignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<AssinafySignatureRequestAttributes, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        url: assinafyPath(baseUrl, "v1", "documents", id),
        headers: authHeaders(options),
      },
      AssinafyDocumentResultSchema,
      AssinafySchemaName.documentResult,
    )
    .pipe(Effect.map((result) => toAssinafySignatureRequestAttributes(baseUrl, result.data)));

const listAssinafySignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
): Effect.Effect<AssinafySignatureRequestAttributes[], SignatureKitError> =>
  Stream.paginate(ASSINAFY_LIST_FIRST_PAGE, (page) => {
    const url = new URL(assinafyPath(baseUrl, "v1", "accounts", options.accountId, "documents"));
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(ASSINAFY_LIST_PER_PAGE));
    return http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          url: url.toString(),
          headers: authHeaders(options),
        },
        AssinafyDocumentsResultSchema,
        AssinafySchemaName.documentsResult,
      )
      .pipe(
        Effect.map(
          (
            result,
          ): readonly [
            ReadonlyArray<AssinafySignatureRequestAttributes>,
            Option.Option<number>,
          ] => [
            result.data.map((document) => toAssinafySignatureRequestAttributes(baseUrl, document)),
            result.data.length < ASSINAFY_LIST_PER_PAGE ? Option.none() : Option.some(page + 1),
          ],
        ),
      );
  }).pipe(
    Stream.runCollect,
    Effect.map((requests) => requests.flat()),
  );

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
      url: assinafyPath(baseUrl, "v1", "documents", id),
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
        return requestBytesFromUrl(assinafyPath(baseUrl, "v1", "documents", id, "download"));
      }
      return requestBytesFromUrl(`${request.detailsUrl}/download`);
    }),
  );

const createAssinafySignatureRequest = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  input: AssinafySignatureRequestInput,
): Effect.Effect<AssinafySignatureRequestAttributes, SignatureKitError> => {
  const [document] = input.documents;

  return uploadDocument(http, options, baseUrl, document).pipe(
    Effect.flatMap((uploadedDocument) =>
      Effect.forEach(
        input.recipients,
        (recipient) => createSigner(http, options, baseUrl, recipient),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.flatMap((signerIds) =>
          createAssignment(http, options, baseUrl, uploadedDocument.id, signerIds, input),
        ),
        Effect.flatMap((assignment) =>
          getAssinafySignatureRequestInternal(http, options, baseUrl, uploadedDocument.id).pipe(
            Effect.map((request) => ({
              ...request,
              signingUrl:
                request.signingUrl ?? assignment.signingUrl ?? uploadedDocument.signingUrl,
            })),
          ),
        ),
        Effect.catch((error) =>
          deleteAssinafySignatureRequestInternal(http, options, baseUrl, uploadedDocument.id).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      ),
    ),
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
        diff: assinafySignatureRequestDiff,
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
          const input = yield* assinafySignatureRequestInputFromResourceProps(news);
          return yield* createAssinafySignatureRequest(http, options, baseUrl, input);
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
): Effect.Effect<AssinafySignatureRequestAttributes, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: AssinafySchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getAssinafySignatureRequestInternal(http, valid, assinafyBaseUrl(valid), id);
  });

export const listAssinafySignatureRequests = (
  options: AssinafyProviderOptions,
): Effect.Effect<
  readonly AssinafySignatureRequestAttributes[],
  SignatureKitError,
  SignatureHttpClient
> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(AssinafyProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: AssinafySchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listAssinafySignatureRequestsInternal(http, valid, assinafyBaseUrl(valid));
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
            schemaName: AssinafySchemaName.providerOptions,
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
            schemaName: AssinafySchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadAssinafySignedDocumentInternal(http, valid, assinafyBaseUrl(valid), id);
  });
