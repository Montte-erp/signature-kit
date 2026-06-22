import { bytesToBase64 } from "@signature-kit/crypto";
import {
  ProviderHttpClient,
  SignatureProvider,
  SignatureProviderError,
  SignatureProviderErrorCodeValue,
  SignatureProviderOperationValue,
  appendDocumentFile,
  createSignatureProviderService,
  decodeProviderOptions,
  decodeProviderShape,
  normalizeSignatureRequestInput,
  normalizedBaseUrl,
} from "@signature-kit/signature-gateway";
import type {
  ProviderHttpClientService,
  SignatureProviderAdapter,
  SignatureProviderFactory,
} from "@signature-kit/signature-gateway";
import { Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER = "dropbox-sign";
const DEFAULT_BASE_URL = "https://api.hellosign.com/v3";

const redactedString: Schema.Decoder<Redacted.Redacted<string>> = Schema.Redacted(Schema.String);

export const DropboxSignProviderOptionsSchema = Schema.Struct({
  apiKey: redactedString,
  baseUrl: Schema.optional(Schema.NonEmptyString),
  testMode: Schema.optional(Schema.Boolean),
});
export type DropboxSignProviderOptions = (typeof DropboxSignProviderOptionsSchema)["Type"];
export const dropboxSignProviderOptionsSchema = DropboxSignProviderOptionsSchema;

const DROPBOX_RESULT_SCHEMA = "DropboxSignatureRequestResult";
const DROPBOX_OPTIONS_SCHEMA = "DropboxSignProviderOptions";

const DropboxSignatureRequestResultSchema = Schema.Struct({
  signature_request: Schema.Struct({
    signature_request_id: Schema.NonEmptyString,
    is_complete: Schema.optional(Schema.Boolean),
    signing_url: Schema.optional(Schema.String),
    details_url: Schema.optional(Schema.String),
  }),
});

const basicAuthorization = (apiKey: Redacted.Redacted<string>): string =>
  `Basic ${bytesToBase64(new TextEncoder().encode(`${Redacted.value(apiKey)}:`))}`;

const signerOrder = (value: number | undefined, index: number): string =>
  (value ?? index).toString();

const buildFormData = (
  input: Parameters<SignatureProviderAdapter["createSignatureRequest"]>[0],
  testMode: boolean | undefined,
): FormData => {
  const formData = new FormData();
  formData.set("title", input.title);
  formData.set("subject", input.subject ?? input.title);
  if (input.message !== undefined) formData.set("message", input.message);
  formData.set("test_mode", testMode === false ? "0" : "1");

  for (const [index, recipient] of input.recipients.entries()) {
    formData.set(`signers[${index}][email_address]`, recipient.email);
    formData.set(`signers[${index}][name]`, recipient.name);
    formData.set(`signers[${index}][order]`, signerOrder(recipient.routingOrder, index));
  }
  for (const [index, document] of input.documents.entries()) {
    appendDocumentFile(formData, `files[${index}]`, document);
  }

  return formData;
};

export const createDropboxSignProviderAdapter = (
  options: DropboxSignProviderOptions,
  http: ProviderHttpClientService,
): SignatureProviderAdapter => {
  const baseUrl = normalizedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const endpoint = `${baseUrl}/signature_request/send`;

  return {
    id: PROVIDER,
    createSignatureRequest: (input) =>
      normalizeSignatureRequestInput(input).pipe(
        Effect.flatMap((valid) => {
          if (valid.send === false) {
            return Effect.fail(
              new SignatureProviderError({
                code: SignatureProviderErrorCodeValue.unsupportedOperation,
                retryable: false,
                provider: PROVIDER,
                operation: SignatureProviderOperationValue.create,
                reason: "Dropbox Sign send endpoint does not create drafts.",
              }),
            );
          }
          return http.requestJson({
            provider: PROVIDER,
            method: "POST",
            url: endpoint,
            headers: { Authorization: basicAuthorization(options.apiKey) },
            body: buildFormData(valid, options.testMode),
          });
        }),
        Effect.flatMap((body) =>
          decodeProviderShape(
            DropboxSignatureRequestResultSchema,
            DROPBOX_RESULT_SCHEMA,
            PROVIDER,
            body,
          ),
        ),
        Effect.map((result) => ({
          provider: PROVIDER,
          id: result.signature_request.signature_request_id,
          state: "sent",
          providerStatus: result.signature_request.is_complete === true ? "complete" : "sent",
          signingUrl: result.signature_request.signing_url,
          detailsUrl: result.signature_request.details_url,
        })),
      ),
    raw: { provider: PROVIDER, baseUrl },
  };
};

export const dropboxSign =
  (options: DropboxSignProviderOptions): SignatureProviderFactory =>
  (http) =>
    createDropboxSignProviderAdapter(options, http);

export const dropboxSignProviderLayer = (options: DropboxSignProviderOptions) =>
  Layer.effect(
    SignatureProvider,
    ProviderHttpClient.use((http) =>
      decodeProviderOptions(
        dropboxSignProviderOptionsSchema,
        DROPBOX_OPTIONS_SCHEMA,
        PROVIDER,
        options,
      ).pipe(
        Effect.map((valid) =>
          createSignatureProviderService(createDropboxSignProviderAdapter(valid, http)),
        ),
      ),
    ),
  );

export const dropboxSignBasicAuthorization = basicAuthorization;
