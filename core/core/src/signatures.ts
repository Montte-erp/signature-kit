import { Context, Effect, Layer, Schema } from "effect";
import type {
  Certificate,
  SignatureAlgorithm,
  SignatureArtifact,
  SignerIdentity,
  SignInput,
  SignerAdapter,
  VerifyInput,
  VerificationResult,
} from "./config";
import {
  SignatureAlgorithmSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  SignInputSchema,
  VerifyInputSchema,
} from "./config";

export class Signatures extends Context.Service<Signatures, SignerAdapter>()(
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
    Schema.decodeUnknownEffect(SignatureAlgorithmSchema)(algorithm).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid signature algorithm.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.signatureAlgorithm,
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.importSigningKey(valid))),
    ),
  sign: (input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError, Signatures> =>
    Schema.decodeUnknownEffect(SignInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid sign input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.signInput,
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.sign(valid))),
    ),
  verify: (input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError, Signatures> =>
    Schema.decodeUnknownEffect(VerifyInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid verify input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.verifyInput,
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.verify(valid))),
    ),
};
