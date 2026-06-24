import { bytesToBase64 } from "@signature-kit/crypto/base64";
import { signatures } from "@signature-kit/core/signatures";
import type { Signatures } from "@signature-kit/core/signatures";
import type { SignatureKitError } from "@signature-kit/core/config";
import { Effect } from "effect";
import { Parse, SignedXml } from "xmldsigjs";
import type { OptionsSignReference } from "xmldsigjs";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";
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
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
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
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          operation: XmlOperationValue.sign,
        }),
    });

    return yield* Effect.try({
      try: () => signedXml.toString(),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          operation: XmlOperationValue.sign,
        }),
    });
  });
