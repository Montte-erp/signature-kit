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
  RemoteSignatureProvider,
  RemoteSignatureRecipient,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect";

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

const DocuSealSubmissionIdSchema = Schema.Union([Schema.Number, Schema.NonEmptyString]);
const DocuSealSubmitterLinkFields = {
  embed_src: Schema.optional(Schema.NullOr(Schema.String)),
  signing_url: Schema.optional(Schema.NullOr(Schema.String)),
  sign_url: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
};

const DocuSealCreateSubmitterResultSchema = Schema.Struct({
  submission_id: DocuSealSubmissionIdSchema,
  status: Schema.optional(Schema.String),
  ...DocuSealSubmitterLinkFields,
});
const DocuSealSubmitterResultSchema = Schema.Struct({
  status: Schema.optional(Schema.String),
  ...DocuSealSubmitterLinkFields,
  download_url: Schema.optional(Schema.NullOr(Schema.String)),
});
const DocuSealSubmissionResultSchema = Schema.Struct({
  id: DocuSealSubmissionIdSchema,
  status: Schema.optional(Schema.String),
  submitters: Schema.optional(Schema.Array(DocuSealSubmitterResultSchema)),
  combined_document_url: Schema.optional(Schema.NullOr(Schema.String)),
  documents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(DocuSealSubmissionIdSchema),
        name: Schema.optional(Schema.String),
        url: Schema.optional(Schema.NullOr(Schema.String)),
        download_url: Schema.optional(Schema.NullOr(Schema.String)),
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
      url: Schema.optional(Schema.NullOr(Schema.String)),
      download_url: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const DocuSealPaginationSchema = Schema.Struct({
  count: Schema.Number,
  next: Schema.NullOr(Schema.Number),
  prev: Schema.NullOr(Schema.Number),
});
const DocuSealSubmissionsResultSchema = Schema.Struct({
  data: Schema.Array(DocuSealSubmissionResultSchema),
  pagination: DocuSealPaginationSchema,
});

type DocuSealSubmissionResult = (typeof DocuSealSubmissionResultSchema)["Type"];
type DocuSealSubmissionDocumentsResult = (typeof DocuSealSubmissionDocumentsResultSchema)["Type"];
type DocuSealSubmissionsResult = (typeof DocuSealSubmissionsResultSchema)["Type"];

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
            issueMessage: String(issue),
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

const normalizeSubmissionPathId = (submissionId: string): string =>
  encodeURIComponent(submissionId);

const docuSealSubmissionUrl = (baseUrl: string, submissionId: string): string =>
  `${baseUrl}/submissions/${normalizeSubmissionPathId(submissionId)}`;

const docuSealSubmissionListUrl = (baseUrl: string, after?: number): string => {
  const url = new URL(`${baseUrl}/submissions`);
  url.searchParams.set("limit", "100");
  if (after !== undefined) url.searchParams.set("after", after.toString());
  return url.toString();
};

const docuSealSubmissionsNextUrl = (
  baseUrl: string,
  pagination: (typeof DocuSealPaginationSchema)["Type"],
): Option.Option<string> =>
  pagination.next === null
    ? Option.none()
    : Option.some(docuSealSubmissionListUrl(baseUrl, pagination.next));

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

const resolveSubmitterRoles = (
  recipients: ReadonlyArray<RemoteSignatureRecipient>,
): ReadonlyArray<string> => {
  const roleCounts = new Map<string, number>();
  return recipients.map((recipient) => {
    const role = recipient.role ?? recipient.name;
    const count = roleCounts.get(role) ?? 0;
    roleCounts.set(role, count + 1);
    return count === 0 ? role : `${role} (${count + 1})`;
  });
};

const pickSigningUrl = (submission: DocuSealSubmissionResult): string | null | undefined =>
  submission.submitters?.[0]?.embed_src ??
  submission.submitters?.[0]?.signing_url ??
  submission.submitters?.[0]?.sign_url ??
  submission.submitters?.[0]?.url;

const pickDownloadUrl = (submission: DocuSealSubmissionResult): string | null | undefined =>
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
    detailsUrl: docuSealSubmissionUrl(baseUrl, id),
    ...(submission.status === undefined ? {} : { providerStatus: submission.status }),
    ...(signingUrl === undefined || signingUrl === null ? {} : { signingUrl }),
    ...(downloadUrl === undefined || downloadUrl === null ? {} : { downloadUrl }),
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
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> => {
  const submitterRoles = resolveSubmitterRoles(input.recipients);
  return http
    .requestJson(
      {
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
            role: submitterRoles[index],
            order: recipient.routingOrder ?? index,
            ...(input.redirectUrl === undefined
              ? {}
              : { completed_redirect_url: input.redirectUrl }),
          })),
          ...(options.sendSms === undefined ? {} : { send_sms: options.sendSms }),
          ...(input.redirectUrl === undefined ? {} : { completed_redirect_url: input.redirectUrl }),
          ...(input.expiresAt === undefined ? {} : { expire_at: input.expiresAt.toISOString() }),
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.message === undefined ? {} : { message: { body: input.message } }),
        }),
      },
      DocuSealCreateSubmissionResultSchema,
      SignatureKitSchemaNameValue.docuSealSubmissionResult,
    )
    .pipe(
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
          detailsUrl: docuSealSubmissionUrl(baseUrl, id),
          ...(submitter.status === undefined ? {} : { providerStatus: submitter.status }),
          ...(signingUrl === undefined || signingUrl === null ? {} : { signingUrl }),
        };
      }),
    );
};

const submissionsFromListResult = (
  result: DocuSealSubmissionsResult,
): readonly DocuSealSubmissionResult[] => result.data;

const listSubmissions = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
): Effect.Effect<RemoteSignatureRequest[], SignatureKitError> =>
  Stream.paginate(docuSealSubmissionListUrl(baseUrl), (url) =>
    http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          url,
          headers: authHeaders(options),
        },
        DocuSealSubmissionsResultSchema,
        SignatureKitSchemaNameValue.docuSealSubmissionsResult,
      )
      .pipe(
        Effect.map(
          (result): readonly [ReadonlyArray<RemoteSignatureRequest>, Option.Option<string>] => [
            submissionsFromListResult(result).map((submission) =>
              toRemoteSignatureRequest(baseUrl, submission),
            ),
            docuSealSubmissionsNextUrl(baseUrl, result.pagination),
          ],
        ),
      ),
  ).pipe(
    Stream.runCollect,
    Effect.map((requests) => requests.flat()),
  );

const fetchSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocuSealSubmissionResult, SignatureKitError> =>
  http.requestJson(
    {
      provider: PROVIDER,
      method: "GET",
      url: docuSealSubmissionUrl(baseUrl, id),
      headers: authHeaders(options),
    },
    DocuSealSubmissionResultSchema,
    SignatureKitSchemaNameValue.docuSealSubmissionResult,
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
      url: docuSealSubmissionUrl(baseUrl, id),
      headers: authHeaders(options),
    })
    .pipe(
      Effect.catchIf(
        (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
        () => Effect.void,
      ),
    );

const fetchSubmissionDocuments = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<DocuSealSubmissionDocumentsResult, SignatureKitError> =>
  http.requestJson(
    {
      provider: PROVIDER,
      method: "GET",
      url: `${docuSealSubmissionUrl(baseUrl, id)}/documents?merge=true`,
      headers: authHeaders(options),
    },
    DocuSealSubmissionDocumentsResultSchema,
    SignatureKitSchemaNameValue.docuSealSubmissionDocumentsResult,
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
      if (downloadUrl !== undefined && downloadUrl !== null)
        return requestBytesFromUrl(http, downloadUrl);
      return fetchSubmissionDocuments(http, options, baseUrl, id).pipe(
        Effect.flatMap((result) => {
          const url = result.documents[0]?.url ?? result.documents[0]?.download_url;
          if (url === undefined || url === null) {
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
        diff: ({ olds }) => Effect.succeed(olds === undefined ? undefined : { action: "noop" }),
        list: () => listSubmissions(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : fetchSubmission(http, options, baseUrl, output.id).pipe(
                Effect.map((result) => toRemoteSignatureRequest(baseUrl, result)),
                Effect.catchIf(
                  (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
                  () => Effect.succeed(undefined),
                ),
              ),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const input = yield* remoteSignatureInputFromResourceProps(PROVIDER, news);
          return yield* createSubmission(http, options, baseUrl, input);
        }),
        delete: ({ output }) => deleteSubmission(http, options, baseUrl, output.id),
      });
    }),
  );
export class DocuSealProviders extends Provider.ProviderCollection<DocuSealProviders>()(
  DOCUSEAL_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocuSealProviderOptions) =>
  Layer.effect(DocuSealProviders, Provider.collection([DocuSealSignatureRequest])).pipe(
    Layer.provide(DocuSealSignatureRequestProvider()),
    Layer.provide(docuSealCredentialsLayer(options)),
  );

export const getDocuSealSignatureRequest = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    const baseUrl = docuSealBaseUrl(valid);
    return yield* fetchSubmission(http, valid, baseUrl, id).pipe(
      Effect.map((result) => toRemoteSignatureRequest(baseUrl, result)),
    );
  });

export const listDocuSealSignatureRequests = (
  options: DocuSealProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listSubmissions(http, valid, docuSealBaseUrl(valid));
  });

export const deleteDocuSealSignatureRequest = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* deleteSubmission(http, valid, docuSealBaseUrl(valid), id);
  });

export const downloadDocuSealSignedDocument = (
  options: DocuSealProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.docuSealProviderOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadDocumentFromSubmission(http, valid, docuSealBaseUrl(valid), id);
  });
