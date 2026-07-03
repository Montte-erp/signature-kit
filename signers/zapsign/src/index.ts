import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  redactedStringSchema,
} from "@signature-kit/core/config";
import {
  SignatureHttpClient,
  bearerAuthorization,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";

const ZapSignSchemaName = {
  providerOptions: "ZapSignProviderOptions",
  signatureRequestProps: "ZapSignDocumentProps",
  documentResult: "ZapSignDocumentResult",
  documentsResult: "ZapSignDocumentsResult",
} satisfies Record<string, string>;

const ZapSignOperation = {
  create: "zapsign.create",
  download: "zapsign.download",
} satisfies Record<string, string>;

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const ZapSignProviderId = "zapsign";
const PROVIDER = ZapSignProviderId;

export const ZapSignDocumentStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
export type ZapSignDocumentState = (typeof ZapSignDocumentStateSchema)["Type"];

export const ZapSignPdfDocumentSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.Literal("application/pdf"),
  content: Schema.Uint8Array,
});
export type ZapSignPdfDocument = (typeof ZapSignPdfDocumentSchema)["Type"];

export const ZapSignPdfDocumentPropsSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.Literal("application/pdf"),
  contentBase64: base64String,
});
export type ZapSignPdfDocumentProps = (typeof ZapSignPdfDocumentPropsSchema)["Type"];

export const ZapSignSignerSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  routingOrder: Schema.optional(Schema.Number),
});
export type ZapSignSigner = (typeof ZapSignSignerSchema)["Type"];

export const ZapSignDocumentInputSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([ZapSignPdfDocumentSchema]),
  recipients: Schema.NonEmptyArray(ZapSignSignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type ZapSignDocumentInput = (typeof ZapSignDocumentInputSchema)["Type"];

export const ZapSignDocumentPropsSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  message: Schema.optional(Schema.NonEmptyString),
  documents: Schema.Tuple([ZapSignPdfDocumentPropsSchema]),
  recipients: Schema.NonEmptyArray(ZapSignSignerSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(Schema.NonEmptyString),
});
export type ZapSignDocumentProps = (typeof ZapSignDocumentPropsSchema)["Type"];

export const ZapSignDocumentSchema = Schema.Struct({
  provider: Schema.Literal(PROVIDER),
  id: Schema.NonEmptyString,
  state: ZapSignDocumentStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type ZapSignDocument = (typeof ZapSignDocumentSchema)["Type"];

const zapsignSignatureRequestNoopDiff: { readonly action: "noop" } = { action: "noop" };

const zapsignSignatureRequestDiff = ({
  olds,
}: {
  readonly olds: ZapSignDocumentProps | undefined;
}): Effect.Effect<typeof zapsignSignatureRequestNoopDiff | undefined> =>
  Effect.succeed(olds === undefined ? undefined : zapsignSignatureRequestNoopDiff);

const zapsignSignatureRequestInputFromProps = (
  props: ZapSignDocumentProps,
): ZapSignDocumentInput => {
  const [document] = props.documents;
  return {
    title: props.title,
    documents: [
      {
        fileName: document.fileName,
        mimeType: document.mimeType,
        content: Uint8Array.fromBase64(document.contentBase64),
      },
    ],
    recipients: props.recipients,
    ...(props.message === undefined ? {} : { message: props.message }),
    ...(props.send === undefined ? {} : { send: props.send }),
    ...(props.expiresAt === undefined ? {} : { expiresAt: props.expiresAt }),
    ...(props.redirectUrl === undefined ? {} : { redirectUrl: props.redirectUrl }),
  };
};

const zapsignSignatureRequestInputFromResourceProps = (
  props: unknown,
): Effect.Effect<ZapSignDocumentInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(ZapSignDocumentPropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: ZapSignSchemaName.signatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(zapsignSignatureRequestInputFromProps),
  );

const ZAPSIGN_PROVIDER_COLLECTION_ID = "@signature-kit/zapsign/Providers";
const SANDBOX_BASE_URL = "https://sandbox.api.zapsign.com.br/api/v1";
const PRODUCTION_BASE_URL = "https://api.zapsign.com.br/api/v1";
const BRAZIL_BASE_URL = "https://br.api.zapsign.com.br/api/v1";

const publicIdentifier: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;

const ZapSignEnvironmentSchema = Schema.Literals(["production", "sandbox", "brazil"]);
export type ZapSignEnvironment = (typeof ZapSignEnvironmentSchema)["Type"];

const ZapSignLocaleSchema = Schema.Literals(["pt-br", "es", "en"]);
export type ZapSignLocale = (typeof ZapSignLocaleSchema)["Type"];

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
export type ZapSignAuthMode = (typeof ZapSignAuthModeSchema)["Type"];

export const ZapSignProviderOptionsSchema = Schema.Struct({
  apiToken: redactedStringSchema,
  environment: Schema.optional(ZapSignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ZapSignLocaleSchema),
  authMode: Schema.optional(ZapSignAuthModeSchema),
  disableSignerEmails: Schema.optional(Schema.Boolean),
});
export type ZapSignProviderOptions = (typeof ZapSignProviderOptionsSchema)["Type"];

const ZapSignSignerResultSchema = Schema.Struct({
  // ZapSign's list endpoint omits the signer token on some entries, and the
  // signer token is never read (only sign_url is used), so keep it optional.
  token: Schema.optional(publicIdentifier),
  sign_url: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  status: Schema.optional(Schema.String),
});

const ZapSignDocumentResultSchema = Schema.Struct({
  token: publicIdentifier,
  status: Schema.optional(Schema.String),
  original_file: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  signed_file: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  signers: Schema.optional(Schema.Array(ZapSignSignerResultSchema)),
});
type ZapSignDocumentResult = (typeof ZapSignDocumentResultSchema)["Type"];

const ZapSignDocumentsResultSchema = Schema.Struct({
  count: Schema.optional(Schema.Number),
  next: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  previous: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  results: Schema.Array(ZapSignDocumentResultSchema),
});

export type ZapSignSignatureRequest = Resource<
  "SignatureKit.ZapSignSignatureRequest",
  ZapSignDocumentProps,
  ZapSignDocument
>;

export const ZapSignSignatureRequest = Resource<ZapSignSignatureRequest>(
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
    Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    ),
  );

const zapSignBaseUrl = (options: ZapSignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment === "brazil") return BRAZIL_BASE_URL;
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return SANDBOX_BASE_URL;
};

const signerPayload = (
  options: ZapSignProviderOptions,
  recipient: ZapSignSigner,
  input: ZapSignDocumentInput,
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
const zapsignPathParam = (id: string): string => encodeURIComponent(id);

const zapSignDocumentState = (status: string | undefined): ZapSignDocument["state"] => {
  if (status === undefined) return "sent";
  switch (status.toLowerCase()) {
    case "draft":
      return "draft";
    case "signed":
    case "completed":
      return "completed";
    case "declined":
    case "refused":
    case "rejected":
      return "declined";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "deleted":
      return "deleted";
    case "expired":
      return "expired";
    default:
      return "sent";
  }
};

const toZapSignDocument = (
  baseUrl: string,
  result: ZapSignDocumentResult,
  state?: ZapSignDocument["state"],
): ZapSignDocument => {
  const signingUrl = result.signers?.[0]?.sign_url;
  const signedFile = result.signed_file;

  return {
    provider: PROVIDER,
    id: result.token,
    state: state ?? zapSignDocumentState(result.status),
    // detailsUrl is the provider request-details endpoint, consistent with the
    // other providers — original_file is the raw UNSIGNED PDF, not details.
    detailsUrl: `${baseUrl}/docs/${zapsignPathParam(result.token)}/`,
    ...(result.status === undefined ? {} : { providerStatus: result.status }),
    ...(signingUrl === undefined || signingUrl === null ? {} : { signingUrl }),
    ...(signedFile === undefined || signedFile === null ? {} : { downloadUrl: signedFile }),
  };
};

const createZapSignDocument = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  input: ZapSignDocumentInput,
): Effect.Effect<ZapSignDocument, SignatureKitError> => {
  const [document] = input.documents;

  return http
    .requestJson(
      {
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
      },
      ZapSignDocumentResultSchema,
      ZapSignSchemaName.documentResult,
    )
    .pipe(
      Effect.map((result) =>
        toZapSignDocument(baseUrl, result, input.send === false ? "draft" : "sent"),
      ),
    );
};

const getZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<ZapSignDocument, SignatureKitError> =>
  http
    .requestJson(
      {
        provider: PROVIDER,
        method: "GET",
        url: `${baseUrl}/docs/${zapsignPathParam(id)}/`,
        headers: {
          Authorization: bearerAuthorization(options.apiToken),
        },
      },
      ZapSignDocumentResultSchema,
      ZapSignSchemaName.documentResult,
    )
    .pipe(Effect.map((result) => toZapSignDocument(baseUrl, result)));

const resolveZapSignListNextUrl = (
  baseUrl: string,
  next: string | null | undefined,
): string | null => {
  if (next === undefined || next === null || next === "") return null;
  if (URL.canParse(next)) {
    const parsed = new URL(next);
    // ZapSign returns the pagination `next` link with an http:// scheme; the
    // http→https redirect strips the Authorization header and the follow-up
    // page 403s. Pin the next URL onto the configured base origin (scheme +
    // host) while keeping its path and query so auth survives.
    if (URL.canParse(baseUrl)) {
      const base = new URL(baseUrl);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
    }
    return parsed.toString();
  }
  if (!URL.canParse(baseUrl)) return null;

  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith("/") ? base.pathname.slice(0, -1) : base.pathname;
  let normalizedNext = next.startsWith("/") ? next : `/${next}`;
  if (
    basePath !== "" &&
    normalizedNext !== basePath &&
    !normalizedNext.startsWith(`${basePath}/`)
  ) {
    normalizedNext = `${basePath}${normalizedNext}`;
  }
  return URL.canParse(normalizedNext, `${base.origin}/`)
    ? new URL(normalizedNext, `${base.origin}/`).toString()
    : null;
};

const listZapSignSignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
): Effect.Effect<ZapSignDocument[], SignatureKitError> => {
  const initialUrl = new URL(`${baseUrl}/docs/`);
  initialUrl.searchParams.set("page", "1");
  initialUrl.searchParams.set("include_signers", "true");

  return Stream.paginate(initialUrl.toString(), (nextUrl) =>
    http
      .requestJson(
        {
          provider: PROVIDER,
          method: "GET",
          url: nextUrl,
          headers: {
            Authorization: bearerAuthorization(options.apiToken),
          },
        },
        ZapSignDocumentsResultSchema,
        ZapSignSchemaName.documentsResult,
      )
      .pipe(
        Effect.map((page): readonly [ReadonlyArray<ZapSignDocument>, Option.Option<string>] => {
          const nextUrl = resolveZapSignListNextUrl(baseUrl, page.next);
          return [
            page.results.map((item) => toZapSignDocument(baseUrl, item)),
            nextUrl === null ? Option.none() : Option.some(nextUrl),
          ];
        }),
      ),
  ).pipe(Stream.runCollect);
};

const cancelZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    url: `${baseUrl}/refuse/`,
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerAuthorization(options.apiToken),
    },
    body: JSON.stringify({
      doc_token: id,
      rejected_reason: "Cancelled by SignatureKit provider lifecycle action.",
      notify_signer: false,
    }),
  });

const deleteZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      url: `${baseUrl}/docs/${zapsignPathParam(id)}/`,
      headers: {
        Authorization: bearerAuthorization(options.apiToken),
      },
    })
    .pipe(
      Effect.catchIf(
        (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
        () => Effect.void,
      ),
    );

const downloadZapSignSignedDocumentInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getZapSignSignatureRequestInternal(http, options, baseUrl, id).pipe(
    Effect.flatMap((request) => {
      const signedFile = request.downloadUrl;
      if (signedFile !== undefined) {
        return http.requestBytes({
          provider: PROVIDER,
          method: "GET",
          url: signedFile,
        });
      }
      return Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.unsupportedOperation,
          retryable: false,
          provider: PROVIDER,
          operation: ZapSignOperation.download,
          reason: "No signed-file URL is available for this ZapSign request.",
        }),
      );
    }),
  );

export const ZapSignSignatureRequestProvider = () =>
  Provider.effect(
    ZapSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ZapSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = zapSignBaseUrl(options);

      return ZapSignSignatureRequest.Provider.of({
        diff: zapsignSignatureRequestDiff,
        list: () => listZapSignSignatureRequestsInternal(http, options, baseUrl),
        read: ({ output }) =>
          output === undefined
            ? Effect.succeed(undefined)
            : getZapSignSignatureRequestInternal(http, options, baseUrl, output.id).pipe(
                Effect.catchIf(
                  (error) => error.code === SignatureKitErrorCodeValue.http && error.status === 404,
                  () => Effect.succeed(undefined),
                ),
              ),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const input = yield* zapsignSignatureRequestInputFromResourceProps(news);
          return yield* createZapSignDocument(http, options, baseUrl, input);
        }),
        delete: ({ output }) =>
          deleteZapSignSignatureRequestInternal(http, options, baseUrl, output.id),
      });
    }),
  );

export class ZapSignProviders extends Provider.ProviderCollection<ZapSignProviders>()(
  ZAPSIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: ZapSignProviderOptions) =>
  Layer.effect(ZapSignProviders, Provider.collection([ZapSignSignatureRequest])).pipe(
    Layer.provide(ZapSignSignatureRequestProvider()),
    Layer.provide(zapSignCredentialsLayer(options)),
  );

export const getZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<ZapSignDocument, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* getZapSignSignatureRequestInternal(http, valid, zapSignBaseUrl(valid), id);
  });

export const listZapSignSignatureRequests = (
  options: ZapSignProviderOptions,
): Effect.Effect<readonly ZapSignDocument[], SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* listZapSignSignatureRequestsInternal(http, valid, zapSignBaseUrl(valid));
  });

export const cancelZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* cancelZapSignSignatureRequestInternal(http, valid, zapSignBaseUrl(valid), id);
  });

export const deleteZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* deleteZapSignSignatureRequestInternal(http, valid, zapSignBaseUrl(valid), id);
  });

export const downloadZapSignSignedDocument = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ZapSignProviderOptionsSchema)(options).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: ZapSignSchemaName.providerOptions,
            issueMessage: String(issue),
          }),
      ),
    );
    const http = yield* SignatureHttpClient;
    return yield* downloadZapSignSignedDocumentInternal(http, valid, zapSignBaseUrl(valid), id);
  });
