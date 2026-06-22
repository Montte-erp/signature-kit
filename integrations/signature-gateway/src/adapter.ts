import { Context, Effect, Layer } from "effect";
import type {
  RemoteSignatureRequest,
  SignatureGatewayRequestInput,
  SignatureProviderId,
  SignatureRequestInput,
} from "./config";
import {
  SignatureProviderError,
  SignatureProviderErrorCodeValue,
  SignatureProviderOperationValue,
} from "./config";
import { createFetchHttpClient, normalizeSignatureGatewayRequestInput } from "./http";
import type { ProviderHttpClientService } from "./http";

export type SignatureProviderAdapter = {
  readonly id: SignatureProviderId;
  readonly createSignatureRequest: (
    input: SignatureRequestInput,
  ) => Effect.Effect<RemoteSignatureRequest, SignatureProviderError>;
  readonly raw: {
    readonly provider: SignatureProviderId;
    readonly baseUrl: string;
  };
};

export type SignatureProviderFactory = (
  http: ProviderHttpClientService,
) => SignatureProviderAdapter;

export type SignatureProviderService = {
  readonly createSignatureRequest: (
    input: SignatureRequestInput,
  ) => Effect.Effect<RemoteSignatureRequest, SignatureProviderError>;
  readonly raw: {
    readonly adapter: SignatureProviderAdapter;
  };
};

export class SignatureProvider extends Context.Service<
  SignatureProvider,
  SignatureProviderService
>()("@signature-kit/signature-gateway/SignatureProvider") {}

export const createSignatureProviderService = (
  adapter: SignatureProviderAdapter,
): SignatureProviderService => ({
  createSignatureRequest: (input) => adapter.createSignatureRequest(input),
  raw: { adapter },
});

export const signatureProviderLayer = (
  adapter: SignatureProviderAdapter,
): Layer.Layer<SignatureProvider> =>
  Layer.succeed(SignatureProvider, createSignatureProviderService(adapter));

export const signatureProviders = {
  createSignatureRequest: (
    input: SignatureRequestInput,
  ): Effect.Effect<RemoteSignatureRequest, SignatureProviderError, SignatureProvider> =>
    SignatureProvider.use((service) => service.createSignatureRequest(input)),
};

export type SignatureGatewaysService = {
  readonly createSignatureRequest: (
    input: SignatureGatewayRequestInput,
  ) => Effect.Effect<RemoteSignatureRequest, SignatureProviderError>;
  readonly raw: {
    readonly adapters: readonly SignatureProviderAdapter[];
  };
};

export type SignatureGatewaySetup = {
  readonly providers: readonly SignatureProviderFactory[];
  readonly http?: ProviderHttpClientService | undefined;
};

export class SignatureGateways extends Context.Service<
  SignatureGateways,
  SignatureGatewaysService
>()("@signature-kit/signature-gateway/SignatureGateways") {}

const adapterFor = (
  adapters: readonly SignatureProviderAdapter[],
  provider: SignatureProviderId,
): SignatureProviderAdapter | undefined => adapters.find((adapter) => adapter.id === provider);

const signatureRequestForProvider = (
  input: SignatureGatewayRequestInput,
): SignatureRequestInput => ({
  title: input.title,
  documents: input.documents,
  recipients: input.recipients,
  ...(input.subject === undefined ? {} : { subject: input.subject }),
  ...(input.message === undefined ? {} : { message: input.message }),
  ...(input.send === undefined ? {} : { send: input.send }),
  ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
});

export const createSignatureGatewaysService = (
  adapters: readonly SignatureProviderAdapter[],
): SignatureGatewaysService => ({
  createSignatureRequest: (input) =>
    normalizeSignatureGatewayRequestInput(input).pipe(
      Effect.flatMap((valid) => {
        const adapter = adapterFor(adapters, valid.provider);
        if (adapter === undefined) {
          return Effect.fail(
            new SignatureProviderError({
              code: SignatureProviderErrorCodeValue.unsupportedOperation,
              retryable: false,
              provider: valid.provider,
              operation: SignatureProviderOperationValue.create,
              reason: `No signature provider adapter registered for ${valid.provider}.`,
            }),
          );
        }
        return adapter.createSignatureRequest(signatureRequestForProvider(valid));
      }),
    ),
  raw: { adapters },
});

export const createSignatureGateway = (setup: SignatureGatewaySetup): SignatureGatewaysService => {
  const http = setup.http ?? createFetchHttpClient();
  return createSignatureGatewaysService(setup.providers.map((provider) => provider(http)));
};

export const signatureGatewaysLayer = (
  adapters: readonly SignatureProviderAdapter[],
): Layer.Layer<SignatureGateways> =>
  Layer.succeed(SignatureGateways, createSignatureGatewaysService(adapters));

export const signatureGateways = {
  createSignatureRequest: (
    input: SignatureGatewayRequestInput,
  ): Effect.Effect<RemoteSignatureRequest, SignatureProviderError, SignatureGateways> =>
    SignatureGateways.use((service) => service.createSignatureRequest(input)),
};
