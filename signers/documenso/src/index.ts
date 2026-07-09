import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  redactedStringSchema,
} from "@signature-kit/signatures";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/http";
import type { SignatureHttpClientService } from "@signature-kit/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Match, Option, Redacted, Schema, Stream } from "effect";

const DocumensoSchemaName = {
  providerOptions: "DocumensoProviderOptions",
  signatureRequestProps: "DocumensoEnvelopeProps",
  createEnvelopeResult: "DocumensoCreateEnvelopeResult",
  distributeEnvelopeResult: "DocumensoDistributeEnvelopeResult",
  envelopeResult: "DocumensoEnvelopeResult",
  envelopeListResult: "DocumensoEnvelopeListResult",
} satisfies Record<string, string>;

const DocumensoOperation = {
  create: "documenso.create",
  download: "documenso.download",
} satisfies Record<string, string>;

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const DocumensoProviderId = "documenso";
const PROVIDER = DocumensoProviderId;

export const DocumensoEnvelopeStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
export type DocumensoEnvelopeState = (typeof DocumensoEnvelopeStateSchema)["Type"];

export const DocumensoEnvelopeDocumentSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  content: Schema.Uint8Array,
});
export type DocumensoEnvelopeDocument = (typeof DocumensoEnvelopeDocumentSchema)["Type"];

export const DocumensoEnvelopeDocumentPropsSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  contentBase64: base64String,
});
export type DocumensoEnvelopeDocumentProps = (typeof DocumensoEnvelopeDocumentPropsSchema)["Type"];

export const DocumensoRecipientRoleSchema = Schema.Literals(["approver", "signer"]);
export type DocumensoRecipientRole = (typeof DocumensoRecipientRoleSchema)["Type"];

export const DocumensoEnvelopeRecipientSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  role: Schema.optional(DocumensoRecipientRoleSchema),
  routingOrder: Schema.optional(Schema.Number),
});
export type DocumensoEnvelopeRecipient = (typeof DocumensoEnvelopeRecipientSchema)["Type"];

export const DocumensoEnvelopeInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  subject: Schema.optional(Schema.NonEmptyString),
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.NonEmptyArray(DocumensoEnvelopeDocumentSchema),
  recipients: Schema.NonEmptyArray(DocumensoEnvelopeRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type DocumensoEnvelopeInput = (typeof DocumensoEnvelopeInputSchema)["Type"];

export const DocumensoEnvelopePropsSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  subject: Schema.optional(Schema.NonEmptyString),
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.NonEmptyArray(DocumensoEnvelopeDocumentPropsSchema),
  recipients: Schema.NonEmptyArray(DocumensoEnvelopeRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type DocumensoEnvelopeProps = (typeof DocumensoEnvelopePropsSchema)["Type"];

export const DocumensoEnvelopeSchema = Schema.Struct({
  provider: Schema.Literal(PROVIDER),
  id: Schema.NonEmptyString,
  state: DocumensoEnvelopeStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type DocumensoEnvelope = (typeof DocumensoEnvelopeSchema)["Type"];

const documensoSignatureRequestNoopDiff: { readonly action: "noop" } = { action: "noop" };

const documensoSignatureRequestDiff = ({
  olds,
}: {
  readonly olds: DocumensoEnvelopeProps | undefined;
}): Effect.Effect<typeof documensoSignatureRequestNoopDiff | undefined> =>
  Effect.succeed(olds === undefined ? undefined : documensoSignatureRequestNoopDiff);

const documensoSignatureRequestInputFromProps = (
  props: DocumensoEnvelopeProps,
): DocumensoEnvelopeInput => {
  const [firstDocument, ...restDocuments] = props.documents;
  return {
    title: props.title,
    documents: [
      {
        fileName: firstDocument.fileName,
        mimeType: firstDocument.mimeType,
        content: Uint8Array.fromBase64(firstDocument.contentBase64),
      },
      ...restDocuments.map((document) => ({
        fileName: document.fileName,
        mimeType: document.mimeType,
        content: Uint8Array.fromBase64(document.contentBase64),
      })),
    ],
    recipients: props.recipients,
    ...(props.subject === undefined ? {} : { subject: props.subject }),
    ...(props.message === undefined ? {} : { message: props.message }),
    ...(props.send === undefined ? {} : { send: props.send }),
    ...(props.expiresAt === undefined ? {} : { expiresAt: props.expiresAt }),
    ...(props.redirectUrl === undefined ? {} : { redirectUrl: props.redirectUrl }),
  };
};

const documensoSignatureRequestInputFromResourceProps = (
  props: unknown,
): Effect.Effect<DocumensoEnvelopeInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(DocumensoEnvelopePropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: DocumensoSchemaName.signatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(documensoSignatureRequestInputFromProps),
  );

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
  signingUrl: Schema.optional(Schema.String),
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
  DocumensoEnvelopeProps,
  DocumensoEnvelope
>;

export const DocumensoSignatureRequest = Resource<DocumensoSignatureRequest>(
  "SignatureKit.DocumensoSignatureRequest",
  { defaultRemovalPolicy: "retain" },
);
class DocumensoCredentials extends Context.Service<
  DocumensoCredentials,
  Effect.Effect<DocumensoProviderOptions, SignatureKitError>
>()("@signature-kit/documenso/Credentials") {}

const documensoCredentialsLayer = (
  options: DocumensoProviderOptions,
): Layer.Layer<DocumensoCredentials> =>
  Layer.effect(
    DocumensoCredentials,
    Effect.cached(
      Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              provider: PROVIDER,
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: DocumensoSchemaName.providerOptions,
              issueMessage: String(issue),
            }),
        ),
      ),
    ),
  );

const documensoBaseUrl = (options: DocumensoProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const documensoAuthorization = (options: DocumensoProviderOptions): string => {
  const token = Redacted.value(options.apiKey);
  return options.authorizationScheme === "bearer" ? `Bearer ${token}` : token;
};

const requestMeta = (input: DocumensoEnvelopeInput) => ({
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

const createEnvelopeBody = (input: DocumensoEnvelopeInput): FormData => {
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
  input: DocumensoEnvelopeInput,
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
    DocumensoSchemaName.createEnvelopeResult,
  );

const distributeEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: DocumensoEnvelopeInput,
  envelope: DocumensoCreateEnvelopeResult,
): Effect.Effect<DocumensoEnvelope, SignatureKitError> =>
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
      DocumensoSchemaName.distributeEnvelopeResult,
    )
    .pipe(
      Effect.map((result) => ({
        provider: PROVIDER,
        id: result.id,
        state: result.success ? "sent" : "draft",
        providerStatus: result.success ? "distributed" : "not_distributed",
        detailsUrl: `${baseUrl}/envelope/${documensoPathId(result.id)}`,
        ...(result.recipients[0]?.signingUrl === undefined
          ? {}
          : { signingUrl: result.recipients[0].signingUrl }),
      })),
    );
const DocumensoEnvelopeStatusSchema = Schema.Literals([
  "DRAFT",
  "PENDING",
  "PROCESSING",
  "SENT",
  "SIGNED",
  "COMPLETED",
  "CLOSED",
  "REJECTED",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "DELETED",
  "EXPIRED",
]);
const isDocumensoEnvelopeStatus = Schema.is(DocumensoEnvelopeStatusSchema);

const mapEnvelopeStatus = (status: string): DocumensoEnvelope["state"] => {
  const normalized = status.toUpperCase();
  if (!isDocumensoEnvelopeStatus(normalized)) return "sent";
  return Match.value(normalized).pipe(
    Match.when("DRAFT", (): DocumensoEnvelope["state"] => "draft"),
    Match.whenOr("PENDING", "PROCESSING", "SENT", (): DocumensoEnvelope["state"] => "sent"),
    Match.whenOr("SIGNED", "COMPLETED", "CLOSED", (): DocumensoEnvelope["state"] => "completed"),
    Match.whenOr("REJECTED", "DECLINED", (): DocumensoEnvelope["state"] => "declined"),
    Match.whenOr("CANCELED", "CANCELLED", (): DocumensoEnvelope["state"] => "cancelled"),
    Match.when("DELETED", (): DocumensoEnvelope["state"] => "deleted"),
    Match.when("EXPIRED", (): DocumensoEnvelope["state"] => "expired"),
    Match.orElse((): DocumensoEnvelope["state"] => "sent"),
  );
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

const mapEnvelopeToDocumensoEnvelope = (
  baseUrl: string,
  envelope: DocumensoEnvelopeResult,
): DocumensoEnvelope => {
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
    DocumensoSchemaName.envelopeResult,
  );

const getEnvelope = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocumensoEnvelope, SignatureKitError> =>
  fetchEnvelopeResult(http, options, baseUrl, id).pipe(
    Effect.map((result) => mapEnvelopeToDocumensoEnvelope(baseUrl, result)),
  );

const listEnvelopes = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
): Effect.Effect<DocumensoEnvelope[], SignatureKitError> => {
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
        DocumensoSchemaName.envelopeListResult,
      )
      .pipe(
        Effect.map((result): readonly [ReadonlyArray<DocumensoEnvelope>, Option.Option<number>] => [
          result.data.map((envelope) => mapEnvelopeToDocumensoEnvelope(baseUrl, envelope)),
          documensoNextPage(result.pagination, page),
        ]),
      );
  }).pipe(Stream.runCollect);
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

const downloadSignedEnvelopeDocument = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  envelopeId: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  fetchEnvelopeResult(http, options, baseUrl, envelopeId).pipe(
    Effect.flatMap((envelope) => {
      if (mapEnvelopeStatus(envelope.status) !== "completed") {
        return Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.unsupportedOperation,
            retryable: false,
            provider: PROVIDER,
            operation: DocumensoOperation.download,
            reason: `Documenso envelope ${envelopeId} is not completed yet (status: ${envelope.status ?? "unknown"}); the signed document does not exist.`,
          }),
        );
      }

      const envelopeItemId = envelope.envelopeItems?.[0]?.id;
      if (envelopeItemId === undefined) {
        return Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.unsupportedOperation,
            retryable: false,
            provider: PROVIDER,
            operation: DocumensoOperation.download,
            reason: `Documenso envelope ${envelopeId} has no downloadable item ID.`,
          }),
        );
      }

      return requestEnvelopeSignedBytes(
        http,
        options,
        baseUrl,
        envelopeSignedDownloadUrl(baseUrl, envelopeItemId),
      );
    }),
  );

const shouldRollbackDocumensoCreate = (error: SignatureKitError): boolean =>
  error.code === SignatureKitErrorCodeValue.http &&
  error.status !== undefined &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 409 &&
  error.status !== 429;

const createDocumensoEnvelopeRequest = (
  http: SignatureHttpClientService,
  options: DocumensoProviderOptions,
  baseUrl: string,
  input: DocumensoEnvelopeInput,
): Effect.Effect<DocumensoEnvelope, SignatureKitError> =>
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
          shouldRollbackDocumensoCreate(error)
            ? deleteEnvelope(http, options, baseUrl, envelope.id).pipe(
                Effect.catch(() => Effect.void),
                Effect.flatMap(() => Effect.fail(error)),
              )
            : Effect.fail(error),
        ),
      );
    }),
  );

const documensoSignatureRequestProvider = Provider.effect(
  DocumensoSignatureRequest,
  Effect.gen(function* () {
    const credentials = yield* DocumensoCredentials;
    const http = yield* SignatureHttpClient;

    return DocumensoSignatureRequest.Provider.of({
      nuke: { skip: true },
      diff: documensoSignatureRequestDiff,
      list: () => Effect.succeed([]),
      read: Effect.fn(function* ({ output }) {
        if (output === undefined) return undefined;
        const options = yield* credentials;
        const baseUrl = documensoBaseUrl(options);
        return yield* getEnvelope(http, options, baseUrl, output.id).pipe(
          Effect.catchIf(
            (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
            () => Effect.succeed(undefined),
          ),
        );
      }),
      reconcile: Effect.fn(function* ({ news, output }) {
        if (output !== undefined) return output;
        const options = yield* credentials;
        const baseUrl = documensoBaseUrl(options);
        const input = yield* documensoSignatureRequestInputFromResourceProps(news);
        return yield* createDocumensoEnvelopeRequest(http, options, baseUrl, input);
      }),
      delete: Effect.fn(function* ({ output }) {
        const options = yield* credentials;
        const baseUrl = documensoBaseUrl(options);
        return yield* deleteEnvelope(http, options, baseUrl, output.id);
      }),
    });
  }),
);

class DocumensoProviders extends Provider.ProviderCollection<DocumensoProviders>()(
  DOCUMENSO_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocumensoProviderOptions) =>
  Layer.effect(DocumensoProviders, Provider.collection([DocumensoSignatureRequest])).pipe(
    Layer.provide(documensoSignatureRequestProvider),
    Layer.provide(documensoCredentialsLayer(options)),
  );

export const getDocumensoSignatureRequest = (
  options: DocumensoProviderOptions,
  id: string,
): Effect.Effect<DocumensoEnvelope, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: DocumensoSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getEnvelope(http, valid, documensoBaseUrl(valid), id);
  });

export const listDocumensoSignatureRequests = (
  options: DocumensoProviderOptions,
): Effect.Effect<ReadonlyArray<DocumensoEnvelope>, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocumensoProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: DocumensoSchemaName.providerOptions,
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
            schemaName: DocumensoSchemaName.providerOptions,
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
            schemaName: DocumensoSchemaName.providerOptions,
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
            schemaName: DocumensoSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadSignedEnvelopeDocument(http, valid, documensoBaseUrl(valid), envelopeId);
  });
