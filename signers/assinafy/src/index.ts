import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
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
  normalizedBaseUrl,
  signatureHttpClientLive,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "assinafy";
const SANDBOX_BASE_URL = "https://sandbox.assinafy.com.br";
const PRODUCTION_BASE_URL = "https://api.assinafy.com.br";

const redactedString: Schema.ConstraintDecoder<Redacted.Redacted<string>> = Schema.Redacted(
  Schema.String,
);

const AssinafyEnvironmentSchema = Schema.Literals(["production", "sandbox"]);
export const assinafyEnvironmentSchema = AssinafyEnvironmentSchema;
export type AssinafyEnvironment = (typeof assinafyEnvironmentSchema)["Type"];

export const AssinafyProviderOptionsSchema = Schema.Struct({
  accountId: Schema.NonEmptyString,
  environment: Schema.optional(AssinafyEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  apiKey: Schema.optional(redactedString),
  accessToken: Schema.optional(redactedString),
});
export type AssinafyProviderOptions = (typeof AssinafyProviderOptionsSchema)["Type"];
export const assinafyProviderOptionsSchema = AssinafyProviderOptionsSchema;
type AssinafyResolvedOptions =
  | (Omit<AssinafyProviderOptions, "apiKey" | "accessToken"> & {
      readonly apiKey: Redacted.Redacted<string>;
      readonly accessToken?: never;
    })
  | (Omit<AssinafyProviderOptions, "apiKey" | "accessToken"> & {
      readonly apiKey?: never;
      readonly accessToken: Redacted.Redacted<string>;
    });

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

export type AssinafySignatureRequestResource = Resource<
  "SignatureKit.AssinafySignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const AssinafySignatureRequest = Resource<AssinafySignatureRequestResource>(
  "SignatureKit.AssinafySignatureRequest",
  { defaultRemovalPolicy: "retain" },
);

export class AssinafyCredentials extends Context.Service<
  AssinafyCredentials,
  AssinafyResolvedOptions
>()("@signature-kit/assinafy/Credentials") {}

export const assinafyCredentialsLayer = (
  options: AssinafyProviderOptions,
): Layer.Layer<AssinafyCredentials, SignatureKitError> =>
  Layer.effect(
    AssinafyCredentials,
    decodeRemoteOptions(
      assinafyProviderOptionsSchema,
      SignatureKitSchemaNameValue.assinafyProviderOptions,
      PROVIDER,
      options,
    ).pipe(Effect.flatMap(requireCredential)),
  );

const requireCredential = (
  options: AssinafyProviderOptions,
): Effect.Effect<AssinafyResolvedOptions, SignatureKitError> => {
  if (options.apiKey !== undefined) {
    return Effect.succeed({
      accountId: options.accountId,
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      apiKey: options.apiKey,
    });
  }
  if (options.accessToken !== undefined) {
    return Effect.succeed({
      accountId: options.accountId,
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      accessToken: options.accessToken,
    });
  }
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.invalidInput,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.schemaDecode,
      schemaName: SignatureKitSchemaNameValue.assinafyProviderOptions,
      reason: "Assinafy requires either apiKey or accessToken.",
    }),
  );
};

const assinafyBaseUrl = (options: AssinafyProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  return options.environment === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
};

const authHeaders = (options: AssinafyResolvedOptions): HeadersInit => {
  if (options.apiKey !== undefined) {
    return { "X-Api-Key": Redacted.value(options.apiKey) };
  }
  return { Authorization: bearerAuthorization(options.accessToken) };
};

const oneDocument = (
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureDocument, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length === 1 && document !== undefined) return Effect.succeed(document);
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.remoteCreate,
      reason: "Assinafy creates assignments for one uploaded document at a time.",
    }),
  );
};

const uploadDocument = (
  http: SignatureHttpClientService,
  options: AssinafyResolvedOptions,
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
  options: AssinafyResolvedOptions,
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
  options: AssinafyResolvedOptions,
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
  options: AssinafyResolvedOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  oneDocument(input).pipe(
    Effect.flatMap((document) => uploadDocument(http, options, baseUrl, document)),
    Effect.flatMap((document) =>
      Effect.forEach(input.recipients, (recipient) =>
        createSigner(http, options, baseUrl, recipient),
      ).pipe(
        Effect.flatMap((signerIds) =>
          createAssignment(http, options, baseUrl, document.id, signerIds, input).pipe(
            Effect.map((assignment) => ({ document, assignment })),
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
        reconcile: Effect.fnUntraced(function* ({ news, output }) {
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
  "SignatureKitAssinafy",
) {}

export const providers = (options: AssinafyProviderOptions) =>
  Layer.effect(AssinafyProviders, Provider.collection([AssinafySignatureRequest])).pipe(
    Layer.provide(AssinafySignatureRequestProvider()),
    Layer.provide(assinafyCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    assinafyProviderOptionsSchema,
    SignatureKitSchemaNameValue.assinafyProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.flatMap(requireCredential),
    Effect.map((valid) => ({ valid, baseUrl: assinafyBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
