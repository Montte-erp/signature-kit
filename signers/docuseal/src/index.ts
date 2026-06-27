import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
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
import {
  SignatureHttpClient,
  decodeRemoteOptions,
  decodeRemoteShape,
  signatureHttpClientLive,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { isResolved } from "alchemy/Diff";
import { Resource } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "docuseal";
const DOCUSEAL_SIGNATURE_REQUEST_RESOURCE = "SignatureKit.DocuSealSignatureRequest";
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

const DocuSealSubmitterResultSchema = Schema.Struct({
  submission_id: Schema.Number,
  status: Schema.optional(Schema.String),
  embed_src: Schema.optional(Schema.String),
});

const DocuSealSubmissionArrayResultSchema = Schema.NonEmptyArray(DocuSealSubmitterResultSchema);
const DocuSealSubmissionObjectResultSchema = Schema.Struct({
  id: Schema.Number,
  status: Schema.optional(Schema.String),
  submitters: Schema.NonEmptyArray(DocuSealSubmitterResultSchema),
});
const DocuSealSubmissionResultSchema = Schema.Union([
  DocuSealSubmissionArrayResultSchema,
  DocuSealSubmissionObjectResultSchema,
]);

export type DocuSealSignatureRequest = Resource<
  typeof DOCUSEAL_SIGNATURE_REQUEST_RESOURCE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocuSealSignatureRequest = Resource<DocuSealSignatureRequest>(
  DOCUSEAL_SIGNATURE_REQUEST_RESOURCE,
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
    decodeRemoteOptions(
      DocuSealProviderOptionsSchema,
      SignatureKitSchemaNameValue.docuSealProviderOptions,
      PROVIDER,
      options,
    ),
  );

const docuSealBaseUrl = (options: DocuSealProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

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
        "X-Auth-Token": Redacted.value(options.apiKey),
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
        decodeRemoteShape(
          DocuSealSubmissionResultSchema,
          SignatureKitSchemaNameValue.docuSealSubmissionResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => {
        if ("submitters" in result) {
          const submitter = result.submitters[0];
          const id = result.id.toString();
          return {
            provider: PROVIDER,
            id,
            state: input.send === false ? "draft" : "sent",
            providerStatus: result.status ?? submitter.status,
            signingUrl: submitter.embed_src,
            detailsUrl: `${baseUrl}/submissions/${id}`,
          };
        }

        const submitter = result[0];
        const id = submitter.submission_id.toString();
        return {
          provider: PROVIDER,
          id,
          state: input.send === false ? "draft" : "sent",
          providerStatus: submitter.status,
          signingUrl: submitter.embed_src,
          detailsUrl: `${baseUrl}/submissions/${id}`,
        };
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
          return yield* createSubmission(http, options, baseUrl, input);
        }),
        delete: () => Effect.void,
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
    Layer.provide(signatureHttpClientLive),
  );

export const createDocuSealSignatureRequest = (
  options: DocuSealProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocuSealProviderOptionsSchema,
    SignatureKitSchemaNameValue.docuSealProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: docuSealBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createSubmission(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
