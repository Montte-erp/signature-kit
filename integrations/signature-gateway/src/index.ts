/**
 * @signature-kit/signature-gateway — provider-neutral signature request gateway.
 *
 * Provider packages live separately under `integrations/<provider>` and plug into this
 * small common seam.
 */

export {
  SignatureGateways,
  SignatureProvider,
  createSignatureGatewaysService,
  createSignatureGateway,
  createSignatureProviderService,
  signatureGateways,
  signatureGatewaysLayer,
  signatureProviderLayer,
  signatureProviders,
} from "./adapter";
export type {
  SignatureGatewaysService,
  SignatureGatewaySetup,
  SignatureProviderFactory,
  SignatureProviderAdapter,
  SignatureProviderService,
} from "./adapter";

export {
  RemoteSignatureRequestSchema,
  SignatureDocumentSchema,
  SignatureGatewayRequestInputSchema,
  SignatureProviderError,
  SignatureProviderErrorCodeValue,
  SignatureProviderOperationValue,
  SignatureProviderSchemaNameValue,
  SignatureRecipientSchema,
  SignatureRequestInputSchema,
  remoteSignatureRequestSchema,
  safeCauseMetadata,
  schemaIssueMetadata,
  signatureDocumentSchema,
  signatureGatewayRequestInputSchema,
  signatureProviderIdSchema,
  signatureProviderStateSchema,
  signatureRecipientRoleSchema,
  signatureRecipientSchema,
  signatureRequestInputSchema,
} from "./config";
export type {
  RemoteSignatureRequest,
  SignatureDocument,
  SignatureGatewayRequestInput,
  SignatureProviderCauseMetadata,
  SignatureProviderErrorCode,
  SignatureProviderId,
  SignatureProviderOperation,
  SignatureProviderSchemaMetadata,
  SignatureProviderSchemaName,
  SignatureProviderState,
  SignatureRecipient,
  SignatureRecipientRole,
  SignatureRequestInput,
} from "./config";

export {
  ProviderHttpClient,
  appendDocumentFile,
  bearerAuthorization,
  createFetchHttpClient,
  decodeProviderOptions,
  decodeProviderShape,
  fileExtension,
  jsonBody,
  jsonContentHeaders,
  jsonHeaders,
  normalizeSignatureGatewayRequestInput,
  normalizeSignatureRequestInput,
  normalizedBaseUrl,
  providerHttpClientLive,
} from "./http";
export type { ProviderHttpClientService, ProviderHttpMethod, ProviderHttpRequest } from "./http";
