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
  bearerAuthorization,
  decodeRemoteOptions,
  decodeRemoteShape,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "adobe-sign";
const ADOBE_SIGN_SIGNATURE_REQUEST_TYPE = "SignatureKit.AdobeSignSignatureRequest";
const ADOBE_SIGN_PROVIDER_COLLECTION_ID = "SignatureKitAdobeSign";
const DEFAULT_BASE_URL = "https://api.na1.echosign.com";

export const AdobeSignProviderOptionsSchema = Schema.Struct({
  accessToken: redactedStringSchema,
  baseUrl: Schema.optional(Schema.NonEmptyString),
});
export type AdobeSignProviderOptions = (typeof AdobeSignProviderOptionsSchema)["Type"];

const AdobeSignTransientDocumentResultSchema = Schema.Struct({
  transientDocumentId: Schema.NonEmptyString,
});

const AdobeSignAgreementResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
});

export type AdobeSignSignatureRequestResource = Resource<
  typeof ADOBE_SIGN_SIGNATURE_REQUEST_TYPE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const AdobeSignSignatureRequest = Resource<AdobeSignSignatureRequestResource>(
  ADOBE_SIGN_SIGNATURE_REQUEST_TYPE,
  { defaultRemovalPolicy: "retain" },
);

export class AdobeSignCredentials extends Context.Service<
  AdobeSignCredentials,
  AdobeSignProviderOptions
>()("@signature-kit/adobe-sign/Credentials") {}

export const adobeSignCredentialsLayer = (
  options: AdobeSignProviderOptions,
): Layer.Layer<AdobeSignCredentials, SignatureKitError> =>
  Layer.effect(
    AdobeSignCredentials,
    decodeRemoteOptions(
      AdobeSignProviderOptionsSchema,
      SignatureKitSchemaNameValue.adobeSignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const adobeSignBaseUrl = (options: AdobeSignProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const documentArrayBuffer = (document: RemoteSignatureDocument): ArrayBuffer => {
  const buffer = new ArrayBuffer(document.content.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(document.content);
  return buffer;
};

const documentFormData = (document: RemoteSignatureDocument): FormData => {
  const formData = new FormData();
  formData.append(
    "File",
    new Blob([documentArrayBuffer(document)], { type: document.mimeType }),
    document.fileName,
  );
  return formData;
};

const uploadDocument = (
  http: SignatureHttpClientService,
  options: AdobeSignProviderOptions,
  baseUrl: string,
  document: RemoteSignatureDocument,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/api/rest/v6/transientDocuments`,
      headers: { Authorization: bearerAuthorization(options.accessToken) },
      body: documentFormData(document),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          AdobeSignTransientDocumentResultSchema,
          SignatureKitSchemaNameValue.adobeSignTransientDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.transientDocumentId),
    );

const createAgreement = (
  http: SignatureHttpClientService,
  options: AdobeSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
  transientDocumentIds: readonly string[],
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/api/rest/v6/agreements`,
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerAuthorization(options.accessToken),
      },
      body: JSON.stringify({
        fileInfos: transientDocumentIds.map((transientDocumentId) => ({ transientDocumentId })),
        name: input.title,
        participantSetsInfo: input.recipients.map((recipient, index) => ({
          memberInfos: [{ email: recipient.email }],
          order: recipient.routingOrder ?? index + 1,
          role: recipient.role === "approver" ? "APPROVER" : "SIGNER",
        })),
        signatureType: "ESIGN",
        state: input.send === false ? "DRAFT" : "IN_PROCESS",
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.redirectUrl === undefined
          ? {}
          : { postSignOption: { redirectUrl: input.redirectUrl } }),
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          AdobeSignAgreementResultSchema,
          SignatureKitSchemaNameValue.adobeSignAgreementResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => ({
        provider: PROVIDER,
        id: result.id,
        state: input.send === false ? "draft" : "sent",
        providerStatus: result.status,
        detailsUrl: `${baseUrl}/api/rest/v6/agreements/${result.id}`,
      })),
    );

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: AdobeSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  Effect.forEach(input.documents, (document) => uploadDocument(http, options, baseUrl, document), {
    concurrency: 1,
  }).pipe(
    Effect.flatMap((transientDocumentIds) =>
      createAgreement(http, options, baseUrl, input, transientDocumentIds),
    ),
  );

export const AdobeSignSignatureRequestProvider = () =>
  Provider.effect(
    AdobeSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* AdobeSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = adobeSignBaseUrl(options);

      return AdobeSignSignatureRequest.Provider.of({
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

export class AdobeSignProviders extends Provider.ProviderCollection<AdobeSignProviders>()(
  ADOBE_SIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: AdobeSignProviderOptions) =>
  Layer.effect(AdobeSignProviders, Provider.collection([AdobeSignSignatureRequest])).pipe(
    Layer.provide(AdobeSignSignatureRequestProvider()),
    Layer.provide(adobeSignCredentialsLayer(options)),
  );

export const createAdobeSignSignatureRequest = (
  options: AdobeSignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    AdobeSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.adobeSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: adobeSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
