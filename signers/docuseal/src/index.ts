import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  redactedStringSchema,
} from "@signature-kit/core/config";
import { SignatureHttpClient, normalizedBaseUrl } from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect";

const DocuSealSchemaName = {
  providerOptions: "DocuSealProviderOptions",
  signatureRequestProps: "DocuSealSubmissionProps",
  submissionResult: "DocuSealSubmissionResult",
  submissionsResult: "DocuSealSubmissionsResult",
  submissionDocumentsResult: "DocuSealSubmissionDocumentsResult",
} satisfies Record<string, string>;

const DocuSealOperation = {
  create: "docuseal.create",
  download: "docuseal.download",
} satisfies Record<string, string>;

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const DocuSealProviderId = "docuseal";
const PROVIDER = DocuSealProviderId;

export const DocuSealSubmissionStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
export type DocuSealSubmissionState = (typeof DocuSealSubmissionStateSchema)["Type"];

export const DocuSealSubmissionDocumentSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  content: Schema.Uint8Array,
});
export type DocuSealSubmissionDocument = (typeof DocuSealSubmissionDocumentSchema)["Type"];

export const DocuSealSubmissionDocumentPropsSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  contentBase64: base64String,
});
export type DocuSealSubmissionDocumentProps =
  (typeof DocuSealSubmissionDocumentPropsSchema)["Type"];

export const DocuSealSubmitterSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  role: Schema.optional(Schema.NonEmptyString),
  routingOrder: Schema.optional(Schema.Number),
});
export type DocuSealSubmitter = (typeof DocuSealSubmitterSchema)["Type"];

export const DocuSealSubmissionInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  subject: Schema.optional(Schema.NonEmptyString),
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.NonEmptyArray(DocuSealSubmissionDocumentSchema),
  recipients: Schema.NonEmptyArray(DocuSealSubmitterSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type DocuSealSubmissionInput = (typeof DocuSealSubmissionInputSchema)["Type"];

export const DocuSealSubmissionPropsSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  subject: Schema.optional(Schema.NonEmptyString),
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.NonEmptyArray(DocuSealSubmissionDocumentPropsSchema),
  recipients: Schema.NonEmptyArray(DocuSealSubmitterSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type DocuSealSubmissionProps = (typeof DocuSealSubmissionPropsSchema)["Type"];

export const DocuSealSubmissionAttributesSchema = Schema.Struct({
  provider: Schema.Literal(PROVIDER),
  id: Schema.NonEmptyString,
  state: DocuSealSubmissionStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type DocuSealSubmissionAttributes = (typeof DocuSealSubmissionAttributesSchema)["Type"];

const docusealSignatureRequestNoopDiff: { readonly action: "noop" } = { action: "noop" };

const docusealSignatureRequestDiff = ({
  olds,
}: {
  readonly olds: DocuSealSubmissionProps | undefined;
}): Effect.Effect<typeof docusealSignatureRequestNoopDiff | undefined> =>
  Effect.succeed(olds === undefined ? undefined : docusealSignatureRequestNoopDiff);

const docusealSignatureRequestInputFromProps = (
  props: DocuSealSubmissionProps,
): DocuSealSubmissionInput => {
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

const docusealSignatureRequestInputFromResourceProps = (
  props: unknown,
): Effect.Effect<DocuSealSubmissionInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(DocuSealSubmissionPropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: DocuSealSchemaName.signatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(docusealSignatureRequestInputFromProps),
  );

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
  DocuSealSubmissionProps,
  DocuSealSubmissionAttributes
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
            schemaName: DocuSealSchemaName.providerOptions,
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

const docuSealSubmissionState = (
  status: string | undefined,
): DocuSealSubmissionAttributes["state"] => {
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
  recipients: ReadonlyArray<DocuSealSubmitter>,
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
const toDocuSealSubmissionAttributes = (
  baseUrl: string,
  submission: DocuSealSubmissionResult,
): DocuSealSubmissionAttributes => {
  const id = normalizeSubmissionId(submission.id);
  const signingUrl = pickSigningUrl(submission);
  const state = docuSealSubmissionState(submission.status);
  // Before completion, documents[0].url points at the UNSIGNED source file —
  // advertising it as downloadUrl would hand callers unsigned bytes.
  const downloadUrl = state === "completed" ? pickDownloadUrl(submission) : undefined;
  return {
    provider: PROVIDER,
    id,
    state,
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
  input: DocuSealSubmissionInput,
): Effect.Effect<DocuSealSubmissionAttributes, SignatureKitError> => {
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
      DocuSealSchemaName.submissionResult,
    )
    .pipe(
      Effect.map((result) => {
        if ("id" in result) {
          const mapped = toDocuSealSubmissionAttributes(baseUrl, result);
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
): Effect.Effect<DocuSealSubmissionAttributes[], SignatureKitError> =>
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
        DocuSealSchemaName.submissionsResult,
      )
      .pipe(
        Effect.map(
          (
            result,
          ): readonly [ReadonlyArray<DocuSealSubmissionAttributes>, Option.Option<string>] => [
            submissionsFromListResult(result).map((submission) =>
              toDocuSealSubmissionAttributes(baseUrl, submission),
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
    DocuSealSchemaName.submissionResult,
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
    DocuSealSchemaName.submissionDocumentsResult,
  );

const downloadDocumentFromSubmission = (
  http: SignatureHttpClientService,
  options: DocuSealProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  fetchSubmission(http, options, baseUrl, id).pipe(
    Effect.flatMap((submission) => {
      if (docuSealSubmissionState(submission.status) !== "completed") {
        return Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.unsupportedOperation,
            retryable: false,
            provider: PROVIDER,
            operation: DocuSealOperation.download,
            reason: `DocuSeal submission ${id} is not completed yet (status: ${submission.status ?? "unknown"}); the signed document does not exist.`,
          }),
        );
      }
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
                operation: DocuSealOperation.download,
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
        diff: docusealSignatureRequestDiff,
        list: () => listSubmissions(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : fetchSubmission(http, options, baseUrl, output.id).pipe(
                Effect.map((result) => toDocuSealSubmissionAttributes(baseUrl, result)),
                Effect.catchIf(
                  (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
                  () => Effect.succeed(undefined),
                ),
              ),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const input = yield* docusealSignatureRequestInputFromResourceProps(news);
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
): Effect.Effect<DocuSealSubmissionAttributes, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: DocuSealSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    const baseUrl = docuSealBaseUrl(valid);
    return yield* fetchSubmission(http, valid, baseUrl, id).pipe(
      Effect.map((result) => toDocuSealSubmissionAttributes(baseUrl, result)),
    );
  });

export const listDocuSealSignatureRequests = (
  options: DocuSealProviderOptions,
): Effect.Effect<readonly DocuSealSubmissionAttributes[], SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(DocuSealProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: DocuSealSchemaName.providerOptions,
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
            schemaName: DocuSealSchemaName.providerOptions,
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
            schemaName: DocuSealSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadDocumentFromSubmission(http, valid, docuSealBaseUrl(valid), id);
  });
