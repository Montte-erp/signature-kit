import { Context, Layer } from "effect";
import type { Effect } from "effect";
import type { SignerAdapter } from "./config";
import type {
  Certificate,
  SignatureAlgorithm,
  SignatureArtifact,
  SignInput,
  SignerIdentity,
  SignatureKitError,
  VerificationResult,
  VerifyInput,
} from "./config";

export type SignaturesService = SignerAdapter;

export class Signatures extends Context.Service<Signatures, SignaturesService>()(
  "@signature-kit/core/Signatures",
) {}

export const signaturesLayer = (signer: SignerAdapter): Layer.Layer<Signatures> =>
  Layer.succeed(Signatures, signer);

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
