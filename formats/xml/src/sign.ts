import { bytesToBase64 } from "@signature-kit/crypto";
import { signatures } from "@signature-kit/core";
import type { Signatures } from "@signature-kit/core";
import type { SignatureKitError } from "@signature-kit/contracts";
import { Effect } from "effect";
import { Parse, SignedXml } from "xmldsigjs";
import type { OptionsSignReference } from "xmldsigjs";
import { XmlError, XmlErrorCodeValue, XmlOperationValue, safeCauseMetadata } from "./config";
import type { XmlSigningRequest } from "./config";
import { ensureXmlRuntime, xmlDigestAlgorithm, xmlSignatureAlgorithm } from "./engine";

export const signXml = (
  input: XmlSigningRequest,
): Effect.Effect<string, XmlError | SignatureKitError, Signatures> =>
  Effect.gen(function* () {
    yield* ensureXmlRuntime();
    const algorithm = input.algorithm ?? "rsa-sha256";
    const certificate = yield* signatures.certificate();
    const signingKey = yield* signatures.importSigningKey(algorithm);

    const document = yield* Effect.try({
      try: () => Parse(input.xml),
      catch: (cause) =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
          ...safeCauseMetadata(cause),
        }),
    });

    const reference: OptionsSignReference =
      input.referenceId === undefined
        ? { hash: xmlDigestAlgorithm(algorithm), transforms: ["enveloped", "exc-c14n"] }
        : {
            hash: xmlDigestAlgorithm(algorithm),
            transforms: ["enveloped", "exc-c14n"],
            uri: `#${input.referenceId}`,
          };

    const signedXml = new SignedXml();
    yield* Effect.tryPromise({
      try: () =>
        signedXml.Sign(xmlSignatureAlgorithm(algorithm), signingKey, document, {
          ...(input.signatureId === undefined ? {} : { id: input.signatureId }),
          x509: [bytesToBase64(certificate.certificateDer)],
          references: [reference],
        }),
      catch: (cause) =>
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          operation: XmlOperationValue.sign,
          ...safeCauseMetadata(cause),
        }),
    });

    return yield* Effect.try({
      try: () => signedXml.toString(),
      catch: (cause) =>
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          operation: XmlOperationValue.sign,
          ...safeCauseMetadata(cause),
        }),
    });
  });
