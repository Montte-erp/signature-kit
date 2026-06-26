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
  RemoteSignatureDocument,
  RemoteSignatureProvider,
  RemoteSignatureRecipient,
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

const PROVIDER: RemoteSignatureProvider = "dropbox-sign";
const DROPBOX_SIGN_SIGNATURE_REQUEST_TYPE = "SignatureKit.DropboxSignSignatureRequest";
const DROPBOX_SIGN_PROVIDER_COLLECTION_ID = "SignatureKitDropboxSign";
const DEFAULT_BASE_URL = "https://api.hellosign.com/v3";
const textEncoder = new TextEncoder();

export const DropboxSignProviderOptionsSchema = Schema.Struct({
  apiKey: redactedStringSchema,
  baseUrl: Schema.optional(Schema.NonEmptyString),
  testMode: Schema.optional(Schema.Boolean),
  clientId: Schema.optional(Schema.NonEmptyString),
});
export type DropboxSignProviderOptions = (typeof DropboxSignProviderOptionsSchema)["Type"];

const DropboxSignSignatureRequestResponseSchema = Schema.Struct({
  signature_request_id: Schema.NonEmptyString,
  details_url: Schema.optional(Schema.String),
  signing_url: Schema.optional(Schema.NullOr(Schema.String)),
  is_complete: Schema.optional(Schema.Boolean),
  has_error: Schema.optional(Schema.Boolean),
  test_mode: Schema.optional(Schema.Boolean),
});

const DropboxSignSignatureRequestResultSchema = Schema.Struct({
  signature_request: DropboxSignSignatureRequestResponseSchema,
});

type DropboxSignSignatureRequestResponse =
  (typeof DropboxSignSignatureRequestResponseSchema)["Type"];

export type DropboxSignSignatureRequestResource = Resource<
  typeof DROPBOX_SIGN_SIGNATURE_REQUEST_TYPE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const DropboxSignSignatureRequest = Resource<DropboxSignSignatureRequestResource>(
  DROPBOX_SIGN_SIGNATURE_REQUEST_TYPE,
  { defaultRemovalPolicy: "retain" },
);

export class DropboxSignCredentials extends Context.Service<
  DropboxSignCredentials,
  DropboxSignProviderOptions
>()("@signature-kit/dropbox-sign/Credentials") {}

export const dropboxSignCredentialsLayer = (
  options: DropboxSignProviderOptions,
): Layer.Layer<DropboxSignCredentials, SignatureKitError> =>
  Layer.effect(
    DropboxSignCredentials,
    decodeRemoteOptions(
      DropboxSignProviderOptionsSchema,
      SignatureKitSchemaNameValue.dropboxSignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const dropboxSignBaseUrl = (options: DropboxSignProviderOptions): string =>
  options.baseUrl === undefined ? DEFAULT_BASE_URL : normalizedBaseUrl(options.baseUrl);

const basicAuthorization = (apiKey: Redacted.Redacted<string>): string =>
  `Basic ${bytesToBase64(textEncoder.encode(`${Redacted.value(apiKey)}:`))}`;

const documentArrayBuffer = (document: RemoteSignatureDocument): ArrayBuffer => {
  const buffer = new ArrayBuffer(document.content.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(document.content);
  return buffer;
};

const appendOptional = (
  formData: FormData,
  name: string,
  value: string | number | boolean | undefined,
): void => {
  if (value !== undefined) formData.append(name, value.toString());
};

const appendRecipient = (
  formData: FormData,
  recipient: RemoteSignatureRecipient,
  index: number,
): void => {
  formData.append(`signers[${index}][name]`, recipient.name);
  formData.append(`signers[${index}][email_address]`, recipient.email);
  appendOptional(formData, `signers[${index}][order]`, recipient.routingOrder);
};

const appendDocument = (
  formData: FormData,
  document: RemoteSignatureDocument,
  index: number,
): void => {
  formData.append(
    `files[${index}]`,
    new Blob([documentArrayBuffer(document)], { type: document.mimeType }),
    document.fileName,
  );
};

const requestBody = (
  options: DropboxSignProviderOptions,
  input: RemoteSignatureRequestInput,
): FormData => {
  const formData = new FormData();
  formData.append("title", input.title);
  appendOptional(formData, "subject", input.subject);
  appendOptional(formData, "message", input.message);
  appendOptional(formData, "client_id", options.clientId);
  appendOptional(formData, "signing_redirect_url", input.redirectUrl);
  appendOptional(
    formData,
    "expires_at",
    input.expiresAt === undefined ? undefined : Math.floor(input.expiresAt.getTime() / 1000),
  );
  formData.append("test_mode", options.testMode === true ? "1" : "0");
  input.recipients.forEach((recipient, index) => appendRecipient(formData, recipient, index));
  input.documents.forEach((document, index) => appendDocument(formData, document, index));
  return formData;
};

const providerStatus = (result: DropboxSignSignatureRequestResponse): string => {
  if (result.has_error === true) return "error";
  if (result.is_complete === true) return "complete";
  if (result.test_mode === true) return "test_sent";
  return "sent";
};

const requireSend = (
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequestInput, SignatureKitError> => {
  if (input.send !== false) return Effect.succeed(input);
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.remoteCreate,
      reason: "Dropbox Sign signature_request/send does not create draft requests.",
    }),
  );
};

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: DropboxSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  requireSend(input).pipe(
    Effect.flatMap((sendable) =>
      http
        .requestJson({
          provider: PROVIDER,
          method: "POST",
          url: `${baseUrl}/signature_request/send`,
          headers: { Authorization: basicAuthorization(options.apiKey) },
          body: requestBody(options, sendable),
        })
        .pipe(
          Effect.flatMap((body) =>
            decodeRemoteShape(
              DropboxSignSignatureRequestResultSchema,
              SignatureKitSchemaNameValue.dropboxSignSignatureRequestResult,
              PROVIDER,
              body,
            ),
          ),
          Effect.map((result) => ({
            provider: PROVIDER,
            id: result.signature_request.signature_request_id,
            state: "sent",
            providerStatus: providerStatus(result.signature_request),
            signingUrl: result.signature_request.signing_url ?? undefined,
            detailsUrl: result.signature_request.details_url,
          })),
        ),
    ),
  );

export const DropboxSignSignatureRequestProvider = () =>
  Provider.effect(
    DropboxSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* DropboxSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = dropboxSignBaseUrl(options);

      return DropboxSignSignatureRequest.Provider.of({
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

export class DropboxSignProviders extends Provider.ProviderCollection<DropboxSignProviders>()(
  DROPBOX_SIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: DropboxSignProviderOptions) =>
  Layer.effect(DropboxSignProviders, Provider.collection([DropboxSignSignatureRequest])).pipe(
    Layer.provide(DropboxSignSignatureRequestProvider()),
    Layer.provide(dropboxSignCredentialsLayer(options)),
  );

export const createDropboxSignSignatureRequest = (
  options: DropboxSignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    DropboxSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.dropboxSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: dropboxSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
