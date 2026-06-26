import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
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
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "documenso";
const DOCUMENSO_SIGNATURE_REQUEST_TYPE = "SignatureKit.DocumensoSignatureRequest";
const DOCUMENSO_PROVIDER_COLLECTION_ID = "SignatureKitDocumenso";
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

export type DocumensoSignatureRequestResource = Resource<
  typeof DOCUMENSO_SIGNATURE_REQUEST_TYPE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocumensoSignatureRequest = Resource<DocumensoSignatureRequestResource>(
  DOCUMENSO_SIGNATURE_REQUEST_TYPE,
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
        signingUrl: result.recipients[0]?.signingUrl,
        detailsUrl: `${baseUrl}/envelope/${result.id}`,
      })),
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

export class DocumensoProviders extends Provider.ProviderCollection<DocumensoProviders>()(
  DOCUMENSO_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocumensoProviderOptions) =>
  Layer.effect(DocumensoProviders, Provider.collection([DocumensoSignatureRequest])).pipe(
    Layer.provide(DocumensoSignatureRequestProvider()),
    Layer.provide(documensoCredentialsLayer(options)),
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
