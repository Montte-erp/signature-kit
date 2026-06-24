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
import type { Effect } from "effect";
import { createSignaturesService } from "./signatures";
import type { SignaturesService } from "./signatures";

export type SignatureKitSetup = {
  readonly signer: SignerAdapter;
};

export type CertificatesRuntime = {
  readonly inspect: () => Effect.Effect<SignerIdentity, SignatureKitError>;
  readonly get: () => Effect.Effect<Certificate, SignatureKitError>;
};

export type SignaturesRuntime = {
  readonly sign: (input: SignInput) => Effect.Effect<SignatureArtifact, SignatureKitError>;
  readonly verify: (input: VerifyInput) => Effect.Effect<VerificationResult, SignatureKitError>;
  readonly importSigningKey: (
    algorithm: SignatureAlgorithm,
  ) => Effect.Effect<CryptoKey, SignatureKitError>;
};

export type SignatureKitRuntime = {
  readonly certificates: CertificatesRuntime;
  readonly signatures: SignaturesRuntime;
  readonly raw: {
    readonly signatures: SignaturesService;
  };
};

export const createSignatureKit = (setup: SignatureKitSetup): SignatureKitRuntime => {
  const signatures = createSignaturesService(setup.signer);
  return {
    certificates: {
      inspect: signatures.inspect,
      get: signatures.certificate,
    },
    signatures: {
      sign: signatures.sign,
      verify: signatures.verify,
      importSigningKey: signatures.importSigningKey,
    },
    raw: { signatures },
  };
};
