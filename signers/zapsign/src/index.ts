import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
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
  bearerAuthorization,
  decodeRemoteOptions,
  decodeRemoteShape,
  normalizedBaseUrl,
  signatureHttpClientLive,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "zapsign";
const SANDBOX_BASE_URL = "https://sandbox.api.zapsign.com.br/api/v1";
const PRODUCTION_BASE_URL = "https://api.zapsign.com.br/api/v1";
const BRAZIL_BASE_URL = "https://br.api.zapsign.com.br/api/v1";

const redactedString: Schema.ConstraintDecoder<Redacted.Redacted<string>> = Schema.Redacted(
  Schema.String,
);
const publicIdentifier: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;

const ZapSignEnvironmentSchema = Schema.Literals(["production", "sandbox", "brazil"]);
export const zapSignEnvironmentSchema = ZapSignEnvironmentSchema;
export type ZapSignEnvironment = (typeof zapSignEnvironmentSchema)["Type"];

const ZapSignLocaleSchema = Schema.Literals(["pt-br", "es", "en"]);
export const zapSignLocaleSchema = ZapSignLocaleSchema;
export type ZapSignLocale = (typeof zapSignLocaleSchema)["Type"];

const ZapSignAuthModeSchema = Schema.Literals([
  "assinaturaTela",
  "tokenEmail",
  "assinaturaTela-tokenEmail",
  "tokenSms",
  "assinaturaTela-tokenSms",
  "tokenWhatsapp",
  "assinaturaTela-tokenWhatsapp",
  "certificadoDigital",
]);
export const zapSignAuthModeSchema = ZapSignAuthModeSchema;
export type ZapSignAuthMode = (typeof zapSignAuthModeSchema)["Type"];

export const ZapSignProviderOptionsSchema = Schema.Struct({
  apiToken: redactedString,
  environment: Schema.optional(ZapSignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ZapSignLocaleSchema),
  authMode: Schema.optional(ZapSignAuthModeSchema),
  disableSignerEmails: Schema.optional(Schema.Boolean),
});
export type ZapSignProviderOptions = (typeof ZapSignProviderOptionsSchema)["Type"];
export const zapSignProviderOptionsSchema = ZapSignProviderOptionsSchema;

const ZapSignSignerResultSchema = Schema.Struct({
  token: publicIdentifier,
  sign_url: Schema.optional(Schema.NonEmptyString),
  status: Schema.optional(Schema.String),
});

const ZapSignDocumentResultSchema = Schema.Struct({
  token: publicIdentifier,
  status: Schema.optional(Schema.String),
  signers: Schema.Array(ZapSignSignerResultSchema),
});

export type ZapSignSignatureRequestResource = Resource<
  "SignatureKit.ZapSignSignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const ZapSignSignatureRequest = Resource<ZapSignSignatureRequestResource>(
  "SignatureKit.ZapSignSignatureRequest",
  { defaultRemovalPolicy: "retain" },
);

export class ZapSignCredentials extends Context.Service<
  ZapSignCredentials,
  ZapSignProviderOptions
>()("@signature-kit/zapsign/Credentials") {}

export const zapSignCredentialsLayer = (
  options: ZapSignProviderOptions,
): Layer.Layer<ZapSignCredentials, SignatureKitError> =>
  Layer.effect(
    ZapSignCredentials,
    decodeRemoteOptions(
      zapSignProviderOptionsSchema,
      SignatureKitSchemaNameValue.zapSignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const zapSignBaseUrl = (options: ZapSignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment === "sandbox") return SANDBOX_BASE_URL;
  if (options.environment === "brazil") return BRAZIL_BASE_URL;
  return PRODUCTION_BASE_URL;
};

const onePdfDocument = (
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureDocument, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length === 1 && document?.mimeType === "application/pdf") {
    return Effect.succeed(document);
  }
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.remoteCreate,
      reason: "ZapSign creates one PDF document per signature request.",
    }),
  );
};

const signerPayload = (
  options: ZapSignProviderOptions,
  recipient: RemoteSignatureRecipient,
  input: RemoteSignatureRequestInput,
  index: number,
) => ({
  name: recipient.name,
  email: recipient.email,
  auth_mode: options.authMode ?? "assinaturaTela",
  send_automatic_email: input.send !== false && options.disableSignerEmails !== true,
  order_group: recipient.routingOrder ?? index + 1,
  ...(input.message === undefined ? {} : { custom_message: input.message }),
  ...(input.redirectUrl === undefined ? {} : { redirect_link: input.redirectUrl }),
});

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  onePdfDocument(input).pipe(
    Effect.flatMap((document) =>
      http
        .requestJson({
          provider: PROVIDER,
          method: "POST",
          url: `${baseUrl}/docs/`,
          headers: {
            "Content-Type": "application/json",
            Authorization: bearerAuthorization(options.apiToken),
          },
          body: JSON.stringify({
            name: input.title,
            base64_pdf: bytesToBase64(document.content),
            lang: options.locale ?? "pt-br",
            disable_signer_emails: input.send === false || options.disableSignerEmails === true,
            signature_order_active: input.recipients.some(
              (recipient) => recipient.routingOrder !== undefined,
            ),
            signers: input.recipients.map((recipient, index) =>
              signerPayload(options, recipient, input, index),
            ),
            ...(input.expiresAt === undefined
              ? {}
              : { date_limit_to_sign: input.expiresAt.toISOString() }),
          }),
        })
        .pipe(
          Effect.flatMap((body) =>
            decodeRemoteShape(
              ZapSignDocumentResultSchema,
              SignatureKitSchemaNameValue.zapSignDocumentResult,
              PROVIDER,
              body,
            ),
          ),
        ),
    ),
    Effect.map((result) => ({
      provider: PROVIDER,
      id: result.token,
      state: input.send === false ? "draft" : "sent",
      providerStatus: result.status,
      signingUrl: result.signers[0]?.sign_url,
    })),
  );

export const ZapSignSignatureRequestProvider = () =>
  Provider.effect(
    ZapSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ZapSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = zapSignBaseUrl(options);

      return ZapSignSignatureRequest.Provider.of({
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

export class ZapSignProviders extends Provider.ProviderCollection<ZapSignProviders>()(
  "SignatureKitZapSign",
) {}

export const providers = (options: ZapSignProviderOptions) =>
  Layer.effect(ZapSignProviders, Provider.collection([ZapSignSignatureRequest])).pipe(
    Layer.provide(ZapSignSignatureRequestProvider()),
    Layer.provide(zapSignCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    zapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
