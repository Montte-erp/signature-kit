import { bytesToBase64 } from "@signature-kit/crypto/base64";
import { signatures } from "@signature-kit/core/signatures";
import type { Signatures } from "@signature-kit/core/signatures";
import type { SignatureAlgorithm, SignatureKitError } from "@signature-kit/core/config";
import { Effect, Schema } from "effect";
import { SignedXml } from "xmldsigjs";
import type { OptionsSignReference } from "xmldsigjs";
import {
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  XmlSchemaNameValue,
  XmlSigningRequestSchema,
} from "./config";
import type { XmlCanonicalization, XmlSigningRequest } from "./config";
import { XmlRuntime } from "./runtime";

const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";
const XML_EXCLUSIVE_CANONICALIZATION_TRANSFORM = "exc-c14n";
const XML_INCLUSIVE_CANONICALIZATION_TRANSFORM = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

const xmlCanonicalizationTransform = (
  canonicalization: XmlCanonicalization | undefined,
): "exc-c14n" | "http://www.w3.org/TR/2001/REC-xml-c14n-20010315" =>
  canonicalization === "inclusive"
    ? XML_INCLUSIVE_CANONICALIZATION_TRANSFORM
    : XML_EXCLUSIVE_CANONICALIZATION_TRANSFORM;

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
    const xmlRuntime = yield* XmlRuntime;
    const input = yield* Schema.decodeUnknownEffect(XmlSigningRequestSchema)(request).pipe(
      Effect.mapError(
        (issue) =>
          new XmlError({
            code: XmlErrorCodeValue.invalidInput,
            retryable: false,
            operation: XmlOperationValue.sign,
            schemaName: XmlSchemaNameValue.signingRequest,
            issueMessage: String(issue),
          }),
      ),
    );
    const algorithm = input.algorithm ?? "rsa-sha256";
    const certificate = yield* signatures.certificate();
    const signingKey = yield* signatures.importSigningKey(algorithm);

    const document = yield* xmlRuntime.parse(input.xml);
    const canonicalizationTransform = xmlCanonicalizationTransform(input.canonicalization);
    const reference: OptionsSignReference =
      input.referenceId === undefined
        ? {
            hash: xmlDigestAlgorithm(algorithm),
            transforms: ["enveloped", canonicalizationTransform],
          }
        : {
            hash: xmlDigestAlgorithm(algorithm),
            transforms: ["enveloped", canonicalizationTransform],
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
