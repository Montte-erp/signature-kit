import { bytesToBase64 } from "@signature-kit/crypto/base64";
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
  RemoteSignatureProvider,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "docuseal";
const DOCUSEAL_PROVIDER_COLLECTION_ID = "@signature-kit/docuseal/Providers";
const DEFAULT_BASE_URL = "https://api.docuseal.com";

const DocuSealSubmittersOrderSchema = Schema.Literals(["preserved", "random"]);
export type DocuSealSubmittersOrder = (typeof DocuSealSubmittersOrderSchema)["Type"];

export const DocuSealProviderOptionsSchema = Schema.Struct({
  apiKey: redactedStringSchema,
  baseUrl: Schema.optional(Schema.NonEmptyString),
  sendSms: Schema.optional(Schema.Boolean),
  submittersOrder: Schema.optional(DocuSealSubmittersOrderSchema),
});
export type DocuSealProviderOptions = (typeof DocuSealProviderOptionsSchema)["Type"];

const DocuSealCreateSubmitterResultSchema = Schema.Struct({
  submission_id: Schema.Union([Schema.Number, Schema.NonEmptyString]),
  status: Schema.optional(Schema.String),
  embed_src: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
  sign_url: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
const DocuSealSubmitterResultSchema = Schema.Struct({
  status: Schema.optional(Schema.String),
  embed_src: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.String),
  sign_url: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  download_url: Schema.optional(Schema.String),
});

const DocuSealSubmissionIdSchema = Schema.Union([Schema.Number, Schema.NonEmptyString]);
const DocuSealSubmissionResultSchema = Schema.Struct({
  id: DocuSealSubmissionIdSchema,
  status: Schema.optional(Schema.String),
  submitters: Schema.optional(Schema.Array(DocuSealSubmitterResultSchema)),
  combined_document_url: Schema.optional(Schema.String),
  documents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(DocuSealSubmissionIdSchema),
        name: Schema.optional(Schema.String),
        url: Schema.optional(Schema.String),
        download_url: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const DocuSealCreateSubmissionResultSchema = Schema.Union([
  Schema.NonEmptyArray(DocuSealCreateSubmitterResultSchema),
  DocuSealSubmissionResultSchema,
]);
const DocuSealSubmissionDocumentsResultSchema = Schema.Struct({
  documents: Schema.Array(
    Schema.Struct({
      url: Schema.optional(Schema.String),
      download_url: Schema.optional(Schema.String),
    }),
  ),
});
const DocuSealSubmissionsResultSchema = Schema.Union([
  Schema.Array(DocuSealSubmissionResultSchema),
  Schema.Struct({
    data: Schema.Array(DocuSealSubmissionResultSchema),
    pagination: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  DocuSealSubmissionDocumentsResultSchema,
]);

type DocuSealSubmissionResult = (typeof DocuSealSubmissionResultSchema)["Type"];
type DocuSealSubmissionDocumentsResult = (typeof DocuSealSubmissionDocumentsResultSchema)["Type"];

export type DocuSealSignatureRequest = Resource<
  "SignatureKit.DocuSealSignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocuSealSignatureRequest = Resource<DocuSealSignatureRequest>(
  "SignatureKit.DocuSealSignatureRequest",
  { defaultRemovalPolicy: "retain" },
);

export class DocuSealCredentials extends Context.Service<
  DocuSealCredentials,
  DocuSealProviderOptions
>()("@signature-kit/docuseal/Credentials") {}

export const docuSealCredentialsLayer = (
  options: DocuSealProviderOptions,
): Layer.Layer<DocuSealCredentials, SignatureKitError> =>
  Layer.effect(
    DocuSealCredentials,
    Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            reason: String(issue),
          }),
      ),
    ),
  );

const docuSealBaseUrl = (options: DocuSealProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const authHeaders = (options: DocuSealProviderOptions): { readonly "X-Auth-Token": string } => ({
  "X-Auth-Token": Redacted.value(options.apiKey),
});

const normalizeSubmissionId = (submissionId: string | number): string =>
  typeof submissionId === "string" ? submissionId : submissionId.toString();

const mapRemoteState = (status: string | undefined): RemoteSignatureRequest["state"] => {
  if (status === undefined) return "sent";
  switch (status.toLowerCase()) {
    case "draft":
      return "draft";
    case "completed":
      return "completed";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "deleted":
    case "archived":
      return "deleted";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "sent";
  }
};

const pickSigningUrl = (submission: DocuSealSubmissionResult): string | undefined =>
  submission.submitters?.[0]?.embed_src ??
  submission.submitters?.[0]?.signing_url ??
  submission.submitters?.[0]?.sign_url ??
  submission.submitters?.[0]?.url;

const pickDownloadUrl = (submission: DocuSealSubmissionResult): string | undefined =>
  submission.combined_document_url ??
  submission.documents?.[0]?.url ??
  submission.documents?.[0]?.download_url;
const toRemoteSignatureRequest = (
  baseUrl: string,
  submission: DocuSealSubmissionResult,
): RemoteSignatureRequest => {
  const id = normalizeSubmissionId(submission.id);
  const signingUrl = pickSigningUrl(submission);
  const downloadUrl = pickDownloadUrl(submission);
  return {
    provider: PROVIDER,
    id,
    state: mapRemoteState(submission.status),
    detailsUrl: `${baseUrl}/submissions/${id}`,
    ...(submission.status === undefined ? {} : { providerStatus: submission.status }),
    ...(signingUrl === undefined ? {} : { signingUrl }),
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
  };
};

const requestBytesFromUrl = (
  http: SignatureHttpClientService,
  url: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  http.requestBytes({
    provider: PROVIDER,
    method: "GET",
    url,
  });

const createSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/submissions/pdf`,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(options),
      },
      body: JSON.stringify({
        name: input.title,
        send_email: input.send !== false,
        order: options.submittersOrder ?? "preserved",
        documents: input.documents.map((document, index) => ({
          name: document.fileName,
          file: bytesToBase64(document.content),
          position: index,
        })),
        submitters: input.recipients.map((recipient, index) => ({
          name: recipient.name,
          email: recipient.email,
          role: recipient.role ?? recipient.name,
          order: recipient.routingOrder ?? index,
          ...(input.redirectUrl === undefined ? {} : { completed_redirect_url: input.redirectUrl }),
        })),
        ...(options.sendSms === undefined ? {} : { send_sms: options.sendSms }),
        ...(input.redirectUrl === undefined ? {} : { completed_redirect_url: input.redirectUrl }),
        ...(input.expiresAt === undefined ? {} : { expire_at: input.expiresAt.toISOString() }),
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.message === undefined ? {} : { message: { body: input.message } }),
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(DocuSealCreateSubmissionResultSchema)(body).pipe(
          Effect.mapError(
            (issue) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.responseShape,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureKitOperationValue.httpDecode,
                schemaName: SignatureKitSchemaNameValue.docuSealSubmissionResult,
                reason: String(issue),
              }),
          ),
        ),
      ),
      Effect.map((result) => {
        if ("id" in result) {
          const mapped = toRemoteSignatureRequest(baseUrl, result);
          const providerStatus = result.status ?? result.submitters?.[0]?.status;
          return {
            ...mapped,
            state: input.send === false ? "draft" : "sent",
            ...(providerStatus === undefined ? {} : { providerStatus }),
          };
        }
        const submitter = result[0];
        const id = normalizeSubmissionId(submitter.submission_id);
        const signingUrl =
          submitter.embed_src ?? submitter.signing_url ?? submitter.sign_url ?? submitter.url;
        return {
          provider: PROVIDER,
          id,
          state: input.send === false ? "draft" : "sent",
          detailsUrl: `${baseUrl}/submissions/${id}`,
          ...(submitter.status === undefined ? {} : { providerStatus: submitter.status }),
          ...(signingUrl === undefined ? {} : { signingUrl }),
        };
      }),
    );

const fetchSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocuSealSubmissionResult, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/submissions/${id}`,
      headers: authHeaders(options),
    })
    .pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(DocuSealSubmissionResultSchema)(body).pipe(
          Effect.mapError(
            (issue) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.responseShape,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureKitOperationValue.httpDecode,
                schemaName: SignatureKitSchemaNameValue.docuSealSubmissionResult,
                reason: String(issue),
              }),
          ),
        ),
      ),
    );

const listSubmissions = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/submissions`,
      headers: authHeaders(options),
    })
    .pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(DocuSealSubmissionsResultSchema)(body).pipe(
          Effect.mapError(
            (issue) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.responseShape,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureKitOperationValue.httpDecode,
                schemaName: SignatureKitSchemaNameValue.docuSealSubmissionsResult,
                reason: String(issue),
              }),
          ),
        ),
      ),
      Effect.map((result) => {
        const submissions = Array.isArray(result) ? result : "data" in result ? result.data : [];
        return submissions.map((submission) => toRemoteSignatureRequest(baseUrl, submission));
      }),
    );

const deleteSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      url: `${baseUrl}/submissions/${id}`,
      headers: authHeaders(options),
    })
    .pipe(
      Effect.catchTag("SignatureKitError", (error) =>
        error.code === SignatureKitErrorCodeValue.http && error.status === 404
          ? Effect.void
          : Effect.fail(error),
      ),
    );

const fetchSubmissionDocuments = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocuSealSubmissionDocumentsResult, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/submissions/${id}/documents?merge=true`,
      headers: authHeaders(options),
    })
    .pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(DocuSealSubmissionDocumentsResultSchema)(body).pipe(
          Effect.mapError(
            (issue) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.responseShape,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureKitOperationValue.httpDecode,
                schemaName: SignatureKitSchemaNameValue.docuSealSubmissionsResult,
                reason: String(issue),
              }),
          ),
        ),
      ),
    );

const downloadDocumentFromSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  fetchSubmission(http, options, baseUrl, id).pipe(
    Effect.flatMap((submission) => {
      const downloadUrl = pickDownloadUrl(submission);
      if (downloadUrl !== undefined) return requestBytesFromUrl(http, downloadUrl);
      return fetchSubmissionDocuments(http, options, baseUrl, id).pipe(
        Effect.flatMap((result) => {
          const url = result.documents[0]?.url ?? result.documents[0]?.download_url;
          if (url === undefined) {
            return Effect.fail(
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.responseShape,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureKitOperationValue.remoteDownload,
                reason: `DocuSeal submission ${id} has no downloadable document URL.`,
              }),
            );
          }
          return requestBytesFromUrl(http, url);
        }),
      );
    }),
  );

export const DocuSealSignatureRequestProvider = () =>
  Provider.effect(
    DocuSealSignatureRequest,
    Effect.gen(function* () {
      const options = yield* DocuSealCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = docuSealBaseUrl(options);

      return DocuSealSignatureRequest.Provider.of({
        diff: () => Effect.succeed({ action: "noop" }),
        list: () => listSubmissions(http, options, baseUrl),
        read: Effect.fn(function* ({ output }) {
          if (output === undefined) return undefined;
          return yield* fetchSubmission(http, options, baseUrl, output.id).pipe(
            Effect.map((result) => toRemoteSignatureRequest(baseUrl, result)),
            Effect.catchTag("SignatureKitError", (error) =>
              error.code === SignatureKitErrorCodeValue.http && error.status === 404
                ? Effect.succeed(undefined)
                : Effect.fail(error),
            ),
          );
        }),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const props = yield* Schema.decodeUnknownEffect(RemoteSignatureRequestPropsSchema)(
            news,
          ).pipe(
            Effect.mapError(
              (issue) =>
                new SignatureKitError({
                  code: SignatureKitErrorCodeValue.invalidInput,
                  retryable: false,
                  provider: PROVIDER,
                  operation: SignatureKitOperationValue.schemaDecode,
                  schemaName: SignatureKitSchemaNameValue.remoteSignatureRequestProps,
                  reason: String(issue),
                }),
            ),
          );
          const input = yield* validRemoteSignatureRequest(remoteSignatureInputFromProps(props));
          return yield* createSubmission(http, options, baseUrl, input);
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* deleteSubmission(http, options, baseUrl, output.id);
        }),
      });
    }),
  );
export class DocuSealProviders extends Provider.ProviderCollection<DocuSealProviders>()(
  DOCUSEAL_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocuSealProviderOptions) =>
  Layer.effect(DocuSealProviders, Provider.collection([DocuSealSignatureRequest])).pipe(
    Layer.provide(DocuSealSignatureRequestProvider()),
    Layer.provideMerge(docuSealCredentialsLayer(options)),
  );

export const getDocuSealSignatureRequest = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options)
    .pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            reason: String(issue),
          }),
      ),
    )
    .pipe(
      Effect.map((valid) => ({ valid, baseUrl: docuSealBaseUrl(valid) })),
      Effect.flatMap(({ valid, baseUrl }) =>
        SignatureHttpClient.use((http) =>
          fetchSubmission(http, valid, baseUrl, id).pipe(
            Effect.map((result) => toRemoteSignatureRequest(baseUrl, result)),
          ),
        ),
      ),
    );

export const listDocuSealSignatureRequests = (
  options: DocuSealProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options)
    .pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            reason: String(issue),
          }),
      ),
    )
    .pipe(
      Effect.map((valid) => ({ valid, baseUrl: docuSealBaseUrl(valid) })),
      Effect.flatMap(({ valid, baseUrl }) =>
        SignatureHttpClient.use((http) => listSubmissions(http, valid, baseUrl)),
      ),
    );

export const cancelDocuSealSignatureRequest = (
  _options: DocuSealProviderOptions,
  _id: string,
): Effect.Effect<void, SignatureKitError> =>
  Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.remoteCancel,
      reason: "DocuSeal does not support cancellation; archive to remove a submission.",
    }),
  );

export const deleteDocuSealSignatureRequest = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options)
    .pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            reason: String(issue),
          }),
      ),
    )
    .pipe(
      Effect.map((valid) => ({ valid, baseUrl: docuSealBaseUrl(valid) })),
      Effect.flatMap(({ valid, baseUrl }) =>
        SignatureHttpClient.use((http) => deleteSubmission(http, valid, baseUrl, id)),
      ),
    );

export const downloadDocuSealSignedDocument = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options)
    .pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            reason: String(issue),
          }),
      ),
    )
    .pipe(
      Effect.map((valid) => ({ valid, baseUrl: docuSealBaseUrl(valid) })),
      Effect.flatMap(({ valid, baseUrl }) =>
        SignatureHttpClient.use((http) => downloadDocumentFromSubmission(http, valid, baseUrl, id)),
      ),
    );
