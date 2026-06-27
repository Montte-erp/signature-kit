import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  redactedStringSchema,
  remoteSignatureInputFromProps,
  validRemoteSignatureRequest,
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
  decodeRemoteOptions,
  decodeRemoteShape,
  signatureHttpClientLive,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpHeaders } from "@signature-kit/core/http";
import { isResolved } from "alchemy/Diff";
import { Resource } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "assinafy";
const ASSINAFY_SIGNATURE_REQUEST_RESOURCE = "SignatureKit.AssinafySignatureRequest";
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

const AssinafyDocumentResultSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.NonEmptyString,
    status: Schema.optional(Schema.String),
    signing_url: Schema.optional(Schema.String),
  }),
});

const AssinafySignerResultSchema = Schema.Struct({
  data: Schema.Struct({ id: Schema.NonEmptyString }),
});

const AssinafyAssignmentResultSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.NonEmptyString,
    signing_urls: Schema.optional(
      Schema.Array(
        Schema.Struct({
          signer_id: Schema.optional(Schema.String),
          url: Schema.NonEmptyString,
        }),
      ),
    ),
  }),
});

export type AssinafySignatureRequest = Resource<
  typeof ASSINAFY_SIGNATURE_REQUEST_RESOURCE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const AssinafySignatureRequest = Resource<AssinafySignatureRequest>(
  ASSINAFY_SIGNATURE_REQUEST_RESOURCE,
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
    decodeRemoteOptions(
      AssinafyProviderOptionsSchema,
      SignatureKitSchemaNameValue.assinafyProviderOptions,
      PROVIDER,
      options,
    ),
  );

const assinafyBaseUrl = (options: AssinafyProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return typeof process !== "undefined" && process.env.NODE_ENV === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
};

const authHeaders = (options: AssinafyProviderOptions): SignatureHttpHeaders => {
  if ("apiKey" in options) {
    return { "X-Api-Key": Redacted.value(options.apiKey) };
  }
  return { Authorization: bearerAuthorization(options.accessToken) };
};

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
  const bytes = new Uint8Array(document.content.length);
  bytes.set(document.content);
  formData.append("file", new Blob([bytes], { type: document.mimeType }), document.fileName);
  return http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/v1/accounts/${options.accountId}/documents`,
      headers: authHeaders(options),
      body: formData,
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          AssinafyDocumentResultSchema,
          SignatureKitSchemaNameValue.assinafyDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => ({ id: result.data.id, signingUrl: result.data.signing_url })),
    );
};

const createSigner = (
  http: SignatureHttpClientService,
  options: AssinafyProviderOptions,
  baseUrl: string,
  recipient: RemoteSignatureRecipient,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/v1/accounts/${options.accountId}/signers`,
      headers: { "Content-Type": "application/json", ...authHeaders(options) },
      body: JSON.stringify({
        full_name: recipient.name,
        email: recipient.email,
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          AssinafySignerResultSchema,
          SignatureKitSchemaNameValue.assinafySignerResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.data.id),
    );

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
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/v1/documents/${documentId}/assignments`,
      headers: { "Content-Type": "application/json", ...authHeaders(options) },
      body: JSON.stringify({
        method: "virtual",
        signers: signerIds.map((id, index) => ({
          id,
          verification_method: "Email",
          notification_methods: ["Email"],
          step: index + 1,
        })),
        message: input.message,
        expires_at: input.expiresAt?.toISOString(),
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          AssinafyAssignmentResultSchema,
          SignatureKitSchemaNameValue.assinafyAssignmentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => ({
        id: result.data.id,
        signingUrl: result.data.signing_urls?.[0]?.url,
      })),
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
        nuke: { skip: true },
        stables: ["provider", "id"],
        list: () => Effect.succeed([]),
        read: ({ output }) => Effect.succeed(output),
        diff: ({ news, output, olds }) => {
          if (!isResolved(news) || output !== undefined || olds !== undefined) {
            return Effect.succeed(undefined);
          }
          return Effect.succeed({ action: "noop" });
        },
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const props = yield* decodeRemoteOptions(
            RemoteSignatureRequestPropsSchema,
            SignatureKitSchemaNameValue.remoteSignatureRequestProps,
            PROVIDER,
            news,
          );
          const input = yield* validRemoteSignatureRequest(remoteSignatureInputFromProps(props));
          return yield* createRemoteRequest(http, options, baseUrl, input);
        }),
        delete: () => Effect.void,
      });
    }),
  );

export class AssinafyProviders extends Provider.ProviderCollection<AssinafyProviders>()(
  ASSINAFY_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: AssinafyProviderOptions) =>
  Layer.effect(AssinafyProviders, Provider.collection([AssinafySignatureRequest])).pipe(
    Layer.provide(AssinafySignatureRequestProvider()),
    Layer.provideMerge(assinafyCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    AssinafyProviderOptionsSchema,
    SignatureKitSchemaNameValue.assinafyProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: assinafyBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
