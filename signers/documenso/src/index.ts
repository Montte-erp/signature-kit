import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  redactedStringSchema,
  remoteSignatureInputFromResourceProps,
} from "@signature-kit/core/config";
import type {
  RemoteSignatureProvider,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect";

const PROVIDER: RemoteSignatureProvider = "documenso";
const DOCUMENSO_PROVIDER_COLLECTION_ID = "@signature-kit/documenso/Providers";
const DEFAULT_BASE_URL = "https://app.documenso.com/api/v2";
const DOCUMENSO_LIST_FIRST_PAGE = 1;
const DOCUMENSO_LIST_PER_PAGE = 100;
const documensoPathId = (pathParam: string): string => encodeURIComponent(pathParam);

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

const DocumensoEnvelopeListPaginationSchema = Schema.Struct({
  page: Schema.Number,
  perPage: Schema.Number,
  totalPages: Schema.Number,
  totalItems: Schema.Number,
});

const DocumensoEnvelopeListResultSchema = Schema.Struct({
  data: Schema.Array(DocumensoEnvelopeResultSchema),
  pagination: DocumensoEnvelopeListPaginationSchema,
});

type DocumensoEnvelopeResult = (typeof DocumensoEnvelopeResultSchema)["Type"];
export type DocumensoSignatureRequest = Resource<
  "SignatureKit.DocumensoSignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocumensoSignatureRequest = Resource<DocumensoSignatureRequest>(
  "SignatureKit.DocumensoSignatureRequest",
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
    Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    ),
  );

const documensoBaseUrl = (options: DocumensoProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const documensoAuthorization = (options: DocumensoProviderOptions): string => {
  const token = Redacted.value(options.apiKey);
  return options.authorizationScheme === "bearer" ? `Bearer ${token}` : token;
};

const requestMeta = (input: RemoteSignatureRequestInput) => ({
  ...(input.subject === undefined ? {} : { subject: input.subject }),
  ...(input.message === undefined ? {} : { message: input.message }),
  ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
});

const documensoNextPage = (
  pagination: (typeof DocumensoEnvelopeListPaginationSchema)["Type"],
  currentPage: number,
): Option.Option<number> =>
  currentPage >= pagination.totalPages ? Option.none() : Option.some(currentPage + 1);

const shouldSendAuthorizationToUrl = (url: string, baseUrl: string): boolean => {
  if (!URL.canParse(url, `${baseUrl}/`) || !URL.canParse(baseUrl)) return false;
  const next = new URL(url, `${baseUrl}/`);
  const base = new URL(baseUrl);
  return next.origin === base.origin;
};

const requestEnvelopeSignedBytes = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  url: string,
): Effect.Effect<Uint8Array, SignatureKitError> => {
  if (shouldSendAuthorizationToUrl(url, baseUrl)) {
    return http.requestBytes({
      provider: PROVIDER,
      method: "GET",
      url,
      headers: { Authorization: documensoAuthorization(options) },
    });
  }
  return http.requestBytes({
    provider: PROVIDER,
    method: "GET",
    url,
  });
};

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
      new Blob([Uint8Array.from(document.content)], { type: document.mimeType }),
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
  http.requestJson(
    {
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/envelope/create`,
      headers: { Authorization: documensoAuthorization(options) },
      body: createEnvelopeBody(input),
    },
    DocumensoCreateEnvelopeResultSchema,
    SignatureKitSchemaNameValue.documensoCreateEnvelopeResult,
  );

const distributeEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
  envelope: DocumensoCreateEnvelopeResult,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "POST",
        url: `${baseUrl}/envelope/distribute`,
        headers: {
          "Content-Type": "application/json",
          Authorization: documensoAuthorization(options),
        },
        body: JSON.stringify({ envelopeId: envelope.id, meta: requestMeta(input) }),
      },
      DocumensoDistributeEnvelopeResultSchema,
      SignatureKitSchemaNameValue.documensoDistributeEnvelopeResult,
    )
    .pipe(
      Effect.map((result) => ({
        provider: PROVIDER,
        id: result.id,
        state: "sent",
        providerStatus: result.success ? "distributed" : "not_distributed",
        detailsUrl: `${baseUrl}/envelope/${documensoPathId(result.id)}`,
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
    case "SIGNED":
    case "COMPLETED":
    case "CLOSED":
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

const envelopeSignedDownloadUrl = (baseUrl: string, envelopeItemId: string): string => {
  const encodedItemId = documensoPathId(envelopeItemId);
  const url = new URL(`${baseUrl}/envelope/item/${encodedItemId}/download`);
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
    detailsUrl: `${baseUrl}/envelope/${documensoPathId(envelope.id)}`,
    ...(signingUrl === undefined ? {} : { signingUrl }),
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
  };
};

const fetchEnvelopeResult = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocumensoEnvelopeResult, SignatureKitError> =>
  http.requestJson(
    {
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/envelope/${documensoPathId(id)}`,
      headers: { Authorization: documensoAuthorization(options) },
    },
    DocumensoEnvelopeResultSchema,
    SignatureKitSchemaNameValue.documensoEnvelopeResult,
  );

const getEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  fetchEnvelopeResult(http, options, baseUrl, id).pipe(
    Effect.map((result) => mapEnvelopeToRemoteRequest(baseUrl, result)),
  );

const listEnvelopes = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> => {
  return Stream.paginate(DOCUMENSO_LIST_FIRST_PAGE, (page) => {
    const url = new URL(`${baseUrl}/envelope`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perPage", String(DOCUMENSO_LIST_PER_PAGE));
    return http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          url: url.toString(),
          headers: { Authorization: documensoAuthorization(options) },
        },
        DocumensoEnvelopeListResultSchema,
        SignatureKitSchemaNameValue.documensoEnvelopeListResult,
      )
      .pipe(
        Effect.map(
          (result): readonly [ReadonlyArray<RemoteSignatureRequest>, Option.Option<number>] => [
            result.data.map((envelope) => mapEnvelopeToRemoteRequest(baseUrl, envelope)),
            documensoNextPage(result.pagination, page),
          ],
        ),
      );
  }).pipe(
    Stream.runCollect,
    Effect.map((requests) => requests.flat()),
  );
};

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
      Effect.catchIf(
        (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
        () => Effect.void,
      ),
    );

const downloadSignedEnvelopeItem = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeItemId: string,
): Effect.Effect<Uint8Array, SignatureKitError> => {
  const encodedItemId = documensoPathId(envelopeItemId);
  const url = new URL(`${baseUrl}/envelope/item/${encodedItemId}/download`);
  url.searchParams.set("version", "signed");
  return requestEnvelopeSignedBytes(http, options, baseUrl, url.toString());
};

const downloadSignedEnvelopeDocument = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeId: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  fetchEnvelopeResult(http, options, baseUrl, envelopeId).pipe(
    Effect.flatMap((envelope) => {
      const downloadUrl = envelopeSignedDownloadUrlFromEnvelope(baseUrl, envelope);
      if (downloadUrl !== undefined) {
        return requestEnvelopeSignedBytes(http, options, baseUrl, downloadUrl);
      }

      if (envelope.envelopeItems?.[0]?.id === undefined) {
        return Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.responseShape,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.remoteDownload,
            reason: `Documenso envelope ${envelopeId} has no downloadable item ID.`,
          }),
        );
      }

      return downloadSignedEnvelopeItem(http, options, baseUrl, envelope.envelopeItems[0].id);
    }),
  );

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  createEnvelope(http, options, baseUrl, input).pipe(
    Effect.flatMap((envelope) => {
      if (input.send === false) {
        return Effect.succeed({
          provider: PROVIDER,
          id: envelope.id,
          state: "draft",
          providerStatus: "DRAFT",
          detailsUrl: `${baseUrl}/envelope/${documensoPathId(envelope.id)}`,
        });
      }
      return distributeEnvelope(http, options, baseUrl, input, envelope).pipe(
        Effect.catch((error) =>
          deleteEnvelope(http, options, baseUrl, envelope.id).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
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
        diff: ({ olds }) => Effect.succeed(olds === undefined ? undefined : { action: "noop" }),
        list: () => listEnvelopes(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : getEnvelope(http, options, baseUrl, output.id).pipe(
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
        delete: ({ output }) => deleteEnvelope(http, options, baseUrl, output.id),
      });
    }),
  );

export class DocumensoProviders extends Provider.ProviderCollection<DocumensoProviders>()(
  DOCUMENSO_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocumensoProviderOptions) =>
  Layer.effect(DocumensoProviders, Provider.collection([DocumensoSignatureRequest])).pipe(
    Layer.provide(DocumensoSignatureRequestProvider()),
    Layer.provide(documensoCredentialsLayer(options)),
  );

export const getDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getEnvelope(http, valid, documensoBaseUrl(valid), id);
  });

export const listDocumensoSignatureRequests = (
  options: DocumensoProviderOptions,
): Effect.Effect<ReadonlyArray<RemoteSignatureRequest>, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listEnvelopes(http, valid, documensoBaseUrl(valid));
  });

export const cancelDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* cancelEnvelope(http, valid, documensoBaseUrl(valid), id);
  });

export const deleteDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* deleteEnvelope(http, valid, documensoBaseUrl(valid), id);
  });

export const downloadDocumensoSignedDocument = (
  options: DocumensoProviderOptions,
  envelopeId: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.documensoProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadSignedEnvelopeDocument(http, valid, documensoBaseUrl(valid), envelopeId);
  });
