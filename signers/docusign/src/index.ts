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
  bearerAuthorization,
  decodeRemoteOptions,
  decodeRemoteShape,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "docusign";
const DOCUSIGN_SIGNATURE_REQUEST_TYPE = "SignatureKit.DocuSignSignatureRequest";
const DOCUSIGN_PROVIDER_COLLECTION_ID = "SignatureKitDocuSign";

export const DocuSignProviderOptionsSchema = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  accessToken: redactedStringSchema,
});
export type DocuSignProviderOptions = (typeof DocuSignProviderOptionsSchema)["Type"];

const DocuSignEnvelopeResultSchema = Schema.Struct({
  envelopeId: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
});

export type DocuSignSignatureRequestResource = Resource<
  typeof DOCUSIGN_SIGNATURE_REQUEST_TYPE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DocuSignSignatureRequest = Resource<DocuSignSignatureRequestResource>(
  DOCUSIGN_SIGNATURE_REQUEST_TYPE,
  { defaultRemovalPolicy: "retain" },
);

export class DocuSignCredentials extends Context.Service<
  DocuSignCredentials,
  DocuSignProviderOptions
>()("@signature-kit/docusign/Credentials") {}

export const docuSignCredentialsLayer = (
  options: DocuSignProviderOptions,
): Layer.Layer<DocuSignCredentials, SignatureKitError> =>
  Layer.effect(
    DocuSignCredentials,
    decodeRemoteOptions(
      DocuSignProviderOptionsSchema,
      SignatureKitSchemaNameValue.docuSignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const documentId = (index: number): string => (index + 1).toString();

const documentFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === fileName.length - 1) return "bin";
  return fileName.slice(lastDot + 1).toLowerCase();
};

const routingOrder = (value: number | undefined, index: number): string =>
  (value ?? index + 1).toString();

const envelopeState = (send: boolean | undefined): "created" | "sent" =>
  send === false ? "created" : "sent";

const toRemoteState = (status: string | undefined): RemoteSignatureRequest["state"] =>
  status === "created" ? "draft" : "sent";

const createEnvelope = (
  http: SignatureHttpClientService,
  options: DocuSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/v2.1/accounts/${options.accountId}/envelopes`,
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerAuthorization(options.accessToken),
      },
      body: JSON.stringify({
        emailSubject: input.subject ?? input.title,
        emailBlurb: input.message,
        status: envelopeState(input.send),
        documents: input.documents.map((document, index) => ({
          documentBase64: bytesToBase64(document.content),
          documentId: documentId(index),
          fileExtension: documentFileExtension(document.fileName),
          name: document.fileName,
        })),
        recipients: {
          signers: input.recipients.map((recipient, index) => ({
            email: recipient.email,
            name: recipient.name,
            recipientId: documentId(index),
            routingOrder: routingOrder(recipient.routingOrder, index),
          })),
        },
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          DocuSignEnvelopeResultSchema,
          SignatureKitSchemaNameValue.docuSignEnvelopeResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => ({
        provider: PROVIDER,
        id: result.envelopeId,
        state: toRemoteState(result.status),
        providerStatus: result.status,
        detailsUrl: result.uri,
      })),
    );

export const DocuSignSignatureRequestProvider = () =>
  Provider.effect(
    DocuSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* DocuSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = normalizedBaseUrl(options.baseUrl);

      return DocuSignSignatureRequest.Provider.of({
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
          return yield* createEnvelope(http, options, baseUrl, input);
        }),
        delete: () => Effect.void,
      });
    }),
  );

export class DocuSignProviders extends Provider.ProviderCollection<DocuSignProviders>()(
  DOCUSIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DocuSignProviderOptions) =>
  Layer.effect(DocuSignProviders, Provider.collection([DocuSignSignatureRequest])).pipe(
    Layer.provide(DocuSignSignatureRequestProvider()),
    Layer.provide(docuSignCredentialsLayer(options)),
  );

export const createDocuSignSignatureRequest = (
  options: DocuSignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DocuSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.docuSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: normalizedBaseUrl(valid.baseUrl) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createEnvelope(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
