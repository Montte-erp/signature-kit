import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitSchemaNameValue,
  redactedStringSchema,
  remoteSignatureInputFromProps,
  validRemoteSignatureRequest,
} from "@signature-kit/core/config";
import type {
  RemoteSignatureDocument,
  RemoteSignatureProvider,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import {
  SignatureHttpClient,
  decodeRemoteOptions,
  decodeRemoteShape,
  signatureHttpClientLive,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "documenso";
const DOCUMENSO_SIGNATURE_REQUEST_RESOURCE = "SignatureKit.DocumensoSignatureRequest";
const DOCUMENSO_PROVIDER_COLLECTION_ID = "@signature-kit/documenso/Providers";
const DEFAULT_BASE_URL = "https://app.documenso.com/api/v2";

const DocumensoAuthorizationSchemeSchema = Schema.Literals(["raw", "bearer"]);
export type DocumensoAuthorizationScheme = (typeof DocumensoAuthorizationSchemeSchema)["Type"];

export const DocumensoProviderOptionsSchema = Schema.Struct({
  apiKey: redactedStringSchema,
  baseUrl: Schema.optional(Schema.NonEmptyString),
  authorizationScheme: Schema.optional(DocumensoAuthorizationSchemeSchema),
});
export type DocumensoProviderOptions = (typeof DocumensoProviderOptionsSchema)["Type"];

const DocumensoCreateEnvelopeResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
});

type DocumensoCreateEnvelopeResult = (typeof DocumensoCreateEnvelopeResultSchema)["Type"];
const DocumensoRecipientResultSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
  signingOrder: Schema.optional(Schema.NullOr(Schema.Number)),
  signingUrl: Schema.String,
});

const DocumensoDistributeEnvelopeResultSchema = Schema.Struct({
  success: Schema.Boolean,
  id: Schema.NonEmptyString,
  recipients: Schema.Array(DocumensoRecipientResultSchema),
});

const DocumensoEnvelopeRecipientResultSchema = Schema.Struct({
  id: Schema.Union([Schema.NonEmptyString, Schema.Number]),
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
  signingUrl: Schema.optional(Schema.NonEmptyString),
});
const DocumensoEnvelopeItemResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
});

const DocumensoEnvelopeResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  recipients: Schema.optional(Schema.Array(DocumensoEnvelopeRecipientResultSchema)),
  envelopeItems: Schema.optional(Schema.Array(DocumensoEnvelopeItemResultSchema)),
});

const DocumensoEnvelopeListResultSchema = Schema.Struct({
  data: Schema.Array(DocumensoEnvelopeResultSchema),
  pagination: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

type DocumensoEnvelopeResult = (typeof DocumensoEnvelopeResultSchema)["Type"];
export type DocumensoSignatureRequest = Resource<
  typeof DOCUMENSO_SIGNATURE_REQUEST_RESOURCE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocumensoSignatureRequest = Resource<DocumensoSignatureRequest>(
  DOCUMENSO_SIGNATURE_REQUEST_RESOURCE,
  { defaultRemovalPolicy: "retain" },
);
export class DocumensoCredentials extends Context.Service<
  DocumensoCredentials,
  DocumensoProviderOptions
>()("@signature-kit/documenso/Credentials") {}

export const documensoCredentialsLayer = (
  options: DocumensoProviderOptions,
): Layer.Layer<DocumensoCredentials, SignatureKitError> =>
  Layer.effect(
    DocumensoCredentials,
    decodeRemoteOptions(
      DocumensoProviderOptionsSchema,
      SignatureKitSchemaNameValue.documensoProviderOptions,
      PROVIDER,
      options,
    ),
  );

const documensoBaseUrl = (options: DocumensoProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const documensoAuthorization = (options: DocumensoProviderOptions): string => {
  const token = Redacted.value(options.apiKey);
  return options.authorizationScheme === "bearer" ? `Bearer ${token}` : token;
};

const documentArrayBuffer = (document: RemoteSignatureDocument): ArrayBuffer => {
  const buffer = new ArrayBuffer(document.content.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(document.content);
  return buffer;
};

const requestMeta = (input: RemoteSignatureRequestInput) => ({
  ...(input.subject === undefined ? {} : { subject: input.subject }),
  ...(input.message === undefined ? {} : { message: input.message }),
  ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
});

const createEnvelopeBody = (input: RemoteSignatureRequestInput): FormData => {
  const formData = new FormData();
  formData.append(
    "payload",
    JSON.stringify({
      type: "DOCUMENT",
      title: input.title,
      recipients: input.recipients.map((recipient) => ({
        name: recipient.name,
        email: recipient.email,
        role: recipient.role === "approver" ? "APPROVER" : "SIGNER",
        ...(recipient.routingOrder === undefined ? {} : { signingOrder: recipient.routingOrder }),
      })),
      meta: requestMeta(input),
    }),
  );
  input.documents.forEach((document) =>
    formData.append(
      "files",
      new Blob([documentArrayBuffer(document)], { type: document.mimeType }),
      document.fileName,
    ),
  );
  return formData;
};

const createEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<DocumensoCreateEnvelopeResult, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/envelope/create`,
      headers: { Authorization: documensoAuthorization(options) },
      body: createEnvelopeBody(input),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          DocumensoCreateEnvelopeResultSchema,
          SignatureKitSchemaNameValue.documensoCreateEnvelopeResult,
          PROVIDER,
          body,
        ),
      ),
    );

const distributeEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
  envelope: DocumensoCreateEnvelopeResult,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/envelope/distribute`,
      headers: {
        "Content-Type": "application/json",
        Authorization: documensoAuthorization(options),
      },
      body: JSON.stringify({ envelopeId: envelope.id, meta: requestMeta(input) }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          DocumensoDistributeEnvelopeResultSchema,
          SignatureKitSchemaNameValue.documensoDistributeEnvelopeResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => ({
        provider: PROVIDER,
        id: result.id,
        state: "sent",
        providerStatus: result.success ? "distributed" : "not_distributed",
        detailsUrl: `${baseUrl}/envelope/${result.id}`,
        ...(result.recipients[0]?.signingUrl === undefined
          ? {}
          : { signingUrl: result.recipients[0].signingUrl }),
      })),
    );
const mapEnvelopeStatus = (status: string): RemoteSignatureRequest["state"] => {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return "draft";
    case "PENDING":
    case "PROCESSING":
    case "SENT":
      return "sent";
    case "COMPLETED":
      return "completed";
    case "REJECTED":
    case "DECLINED":
      return "declined";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "DELETED":
      return "deleted";
    case "EXPIRED":
      return "expired";
    default:
      return "sent";
  }
};
const isHttpNotFound = (error: SignatureKitError): boolean =>
  error.code === SignatureKitErrorCodeValue.http && error.status === 404;

const envelopeSignedDownloadUrl = (baseUrl: string, envelopeItemId: string): string => {
  const url = new URL(`${baseUrl}/envelope/item/${envelopeItemId}/download`);
  url.searchParams.set("version", "signed");
  return url.toString();
};

const envelopeSignedDownloadUrlFromEnvelope = (
  baseUrl: string,
  envelope: DocumensoEnvelopeResult,
): string | undefined => {
  const envelopeItemId = envelope.envelopeItems?.[0]?.id;
  return envelopeItemId === undefined
    ? undefined
    : envelopeSignedDownloadUrl(baseUrl, envelopeItemId);
};

const mapEnvelopeToRemoteRequest = (
  baseUrl: string,
  envelope: DocumensoEnvelopeResult,
): RemoteSignatureRequest => {
  const signingUrl = envelope.recipients?.[0]?.signingUrl;
  const downloadUrl = envelopeSignedDownloadUrlFromEnvelope(baseUrl, envelope);
  return {
    provider: PROVIDER,
    id: envelope.id,
    state: mapEnvelopeStatus(envelope.status),
    providerStatus: envelope.status,
    detailsUrl: `${baseUrl}/envelope/${envelope.id}`,
    ...(signingUrl === undefined ? {} : { signingUrl }),
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
  };
};

const getEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/envelope/${id}`,
      headers: { Authorization: documensoAuthorization(options) },
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          DocumensoEnvelopeResultSchema,
          SignatureKitSchemaNameValue.documensoEnvelopeResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => mapEnvelopeToRemoteRequest(baseUrl, result)),
    );

const listEnvelopes = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
): Effect.Effect<ReadonlyArray<RemoteSignatureRequest>, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/envelope`,
      headers: { Authorization: documensoAuthorization(options) },
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          DocumensoEnvelopeListResultSchema,
          SignatureKitSchemaNameValue.documensoEnvelopeListResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) =>
        result.data.map((envelope) => mapEnvelopeToRemoteRequest(baseUrl, envelope)),
      ),
    );

const cancelEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeId: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    url: `${baseUrl}/envelope/cancel`,
    headers: {
      "Content-Type": "application/json",
      Authorization: documensoAuthorization(options),
    },
    body: JSON.stringify({ envelopeId }),
  });

const deleteEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeId: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/envelope/delete`,
      headers: {
        "Content-Type": "application/json",
        Authorization: documensoAuthorization(options),
      },
      body: JSON.stringify({ envelopeId }),
    })
    .pipe(
      Effect.catchTag("SignatureKitError", (error) =>
        isHttpNotFound(error) ? Effect.void : Effect.fail(error),
      ),
    );

const downloadSignedEnvelopeItem = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeItemId: string,
): Effect.Effect<Uint8Array, SignatureKitError> => {
  const url = new URL(`${baseUrl}/envelope/item/${envelopeItemId}/download`);
  url.searchParams.set("version", "signed");
  return http.requestBytes({
    provider: PROVIDER,
    method: "GET",
    url: url.toString(),
    headers: { Authorization: documensoAuthorization(options) },
  });
};

const downloadSignedEnvelopeDocument = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeId: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getEnvelope(http, options, baseUrl, envelopeId).pipe(
    Effect.flatMap((request) =>
      request.downloadUrl === undefined
        ? downloadSignedEnvelopeItem(http, options, baseUrl, envelopeId)
        : http.requestBytes({
            provider: PROVIDER,
            method: "GET",
            url: request.downloadUrl,
            headers: { Authorization: documensoAuthorization(options) },
          }),
    ),
    Effect.catchTag("SignatureKitError", (error) =>
      isHttpNotFound(error)
        ? downloadSignedEnvelopeItem(http, options, baseUrl, envelopeId)
        : Effect.fail(error),
    ),
  );

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  createEnvelope(http, options, baseUrl, input).pipe(
    Effect.flatMap((envelope) => {
      if (input.send !== false) return distributeEnvelope(http, options, baseUrl, input, envelope);
      return Effect.succeed({
        provider: PROVIDER,
        id: envelope.id,
        state: "draft",
        providerStatus: "DRAFT",
        detailsUrl: `${baseUrl}/envelope/${envelope.id}`,
      });
    }),
  );

export const DocumensoSignatureRequestProvider = () =>
  Provider.effect(
    DocumensoSignatureRequest,
    Effect.gen(function* () {
      const options = yield* DocumensoCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = documensoBaseUrl(options);

      return DocumensoSignatureRequest.Provider.of({
        list: () =>
          listEnvelopes(http, options, baseUrl).pipe(
            Effect.map((requests) => Array.from(requests)),
          ),
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
        delete: Effect.fn(function* ({ output }) {
          if (output === undefined) {
            const requests = yield* listEnvelopes(http, options, baseUrl);
            yield* Effect.forEach(requests, (request) =>
              deleteEnvelope(http, options, baseUrl, request.id),
            );
            return;
          }
          yield* deleteEnvelope(http, options, baseUrl, output.id);
        }),
      });
    }),
  );

export class DocumensoProviders extends Provider.ProviderCollection<DocumensoProviders>()(
  DOCUMENSO_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocumensoProviderOptions) =>
  Layer.effect(DocumensoProviders, Provider.collection([DocumensoSignatureRequest])).pipe(
    Layer.provide(DocumensoSignatureRequestProvider()),
    Layer.provideMerge(documensoCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
export const getDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) => getEnvelope(http, valid, baseUrl, id)),
    ),
  );

export const listDocumensoSignatureRequests = (
  options: DocumensoProviderOptions,
): Effect.Effect<ReadonlyArray<RemoteSignatureRequest>, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) => listEnvelopes(http, valid, baseUrl)),
    ),
  );

export const cancelDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) => cancelEnvelope(http, valid, baseUrl, id)),
    ),
  );

export const deleteDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) => deleteEnvelope(http, valid, baseUrl, id)),
    ),
  );

export const downloadDocumensoSignedDocument = (
  options: DocumensoProviderOptions,
  envelopeItemId: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocumensoProviderOptionsSchema,
    SignatureKitSchemaNameValue.documensoProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: documensoBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        downloadSignedEnvelopeDocument(http, valid, baseUrl, envelopeItemId),
      ),
    ),
  );
