import { bytesToBase64 } from "@signature-kit/crypto/base64";
import { signatures } from "@signature-kit/core/signatures";
import type { Signatures } from "@signature-kit/core/signatures";
import type { SignatureAlgorithm, SignatureKitError } from "@signature-kit/core/config";
import { Effect, Schema } from "effect";
import { Parse, SignedXml } from "xmldsigjs";
import type { OptionsSignReference } from "xmldsigjs";
import {
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  XmlSchemaNameValue,
  XmlSigningRequestSchema,
} from "./config";
import type { XmlSigningRequest } from "./config";
import { XmlRuntime } from "./runtime";

const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

const xmlSignatureAlgorithm = (algorithm: SignatureAlgorithm): RsaHashedImportParams => ({
  name: XML_RSA_ALGORITHM_NAME,
  hash: algorithm === "rsa-sha1" ? "SHA-1" : algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256",
});

const xmlDigestAlgorithm = (algorithm: SignatureAlgorithm): "SHA-1" | "SHA-256" | "SHA-512" =>
  algorithm === "rsa-sha1" ? "SHA-1" : algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256";

export const signXml = (
  request: XmlSigningRequest,
): Effect.Effect<string, XmlError | SignatureKitError, Signatures | XmlRuntime> =>
  Effect.gen(function* () {
    yield* XmlRuntime;
    const input = yield* Schema.decodeUnknownEffect(XmlSigningRequestSchema)(request).pipe(
      Effect.mapError(
        () =>
          new XmlError({
            code: XmlErrorCodeValue.invalidInput,
            retryable: false,
            operation: XmlOperationValue.sign,
            schemaName: XmlSchemaNameValue.signingRequest,
            reason: "XML signing request failed schema validation.",
          }),
      ),
    );
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
