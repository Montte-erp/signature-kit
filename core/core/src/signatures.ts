import { Context, Layer } from "effect";
import type { Effect } from "effect";
import type {
  Certificate,
  SignatureAlgorithm,
  SignatureArtifact,
  SignInput,
  SignerAdapter,
  SignerIdentity,
  SignatureKitError,
  VerificationResult,
  VerifyInput,
} from "./config";

export type SignaturesService = {
  readonly inspect: () => Effect.Effect<SignerIdentity, SignatureKitError>;
  readonly certificate: () => Effect.Effect<Certificate, SignatureKitError>;
  readonly importSigningKey: (
    algorithm: SignatureAlgorithm,
  ) => Effect.Effect<CryptoKey, SignatureKitError>;
  readonly sign: (input: SignInput) => Effect.Effect<SignatureArtifact, SignatureKitError>;
  readonly verify: (input: VerifyInput) => Effect.Effect<VerificationResult, SignatureKitError>;
  readonly raw: {
    readonly signer: SignerAdapter;
  };
};

export class Signatures extends Context.Service<Signatures, SignaturesService>()(
  "@signature-kit/core/Signatures",
) {}

export const createSignaturesService = (signer: SignerAdapter): SignaturesService => ({
  inspect: () => signer.inspect(),
  certificate: () => signer.certificate(),
  importSigningKey: (algorithm) => signer.importSigningKey(algorithm),
  sign: (input) => signer.sign(input),
  verify: (input) => signer.verify(input),
  raw: { signer },
});

export const signaturesLayer = (signer: SignerAdapter): Layer.Layer<Signatures> =>
  Layer.succeed(Signatures, createSignaturesService(signer));

export const signatures = {
  inspect: (): Effect.Effect<SignerIdentity, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.inspect()),
  certificate: (): Effect.Effect<Certificate, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.certificate()),
  importSigningKey: (
    algorithm: SignatureAlgorithm,
  ): Effect.Effect<CryptoKey, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.importSigningKey(algorithm)),
  sign: (input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.sign(input)),
  verify: (input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.verify(input)),
};
