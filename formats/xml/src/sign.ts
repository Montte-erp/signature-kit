import { bytesToBase64 } from "@signature-kit/crypto/base64";
import { signatures } from "@signature-kit/signatures";
import type { Signatures } from "@signature-kit/signatures";
import type { SignatureAlgorithm, SignatureKitError } from "@signature-kit/signatures";
import { Effect, Schema } from "effect";
import type { OptionsSignReference } from "xmldsigjs";
import {
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  XmlSchemaNameValue,
  XmlSigningRequestSchema,
  xmlHashAlgorithmFromSignatureAlgorithm,
} from "./config.js";
import type { XmlCanonicalization, XmlSigningRequest } from "./config.js";
import { XmlRuntime } from "./runtime.js";

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
  hash: xmlHashAlgorithmFromSignatureAlgorithm(algorithm),
});

export const signXml = (
  request: XmlSigningRequest,
): Effect.Effect<string, XmlError | SignatureKitError, Signatures | XmlRuntime> =>
  Effect.gen(function* () {
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
    const xmlRuntime = yield* XmlRuntime;
    const algorithm = input.algorithm ?? "rsa-sha256";

    const document = yield* xmlRuntime.parse(input.xml);
    const sourceSignatureStructure = yield* xmlRuntime.validateSigningDocument(document);
    if (!sourceSignatureStructure.canAppendSignature) {
      return yield* Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          reason: "XML signature count would exceed verification limits.",
          operation: XmlOperationValue.sign,
        }),
      );
    }
    const [certificate, signingKey] = yield* Effect.all(
      [signatures.certificate(), signatures.importSigningKey(algorithm)],
      { concurrency: "unbounded" },
    );
    const canonicalizationTransform = xmlCanonicalizationTransform(input.canonicalization);
    const reference: OptionsSignReference =
      input.referenceId === undefined
        ? {
            hash: xmlHashAlgorithmFromSignatureAlgorithm(algorithm),
            transforms: ["enveloped", canonicalizationTransform],
          }
        : {
            hash: xmlHashAlgorithmFromSignatureAlgorithm(algorithm),
            transforms: ["enveloped", canonicalizationTransform],
            uri: `#${input.referenceId}`,
          };

    const SignedXml = yield* xmlRuntime.signedXml();
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

    const output = yield* Effect.try({
      try: () => signedXml.toString(),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          operation: XmlOperationValue.sign,
        }),
    });
    const signedDocument = yield* xmlRuntime.parse(output).pipe(
      Effect.mapError(
        () =>
          new XmlError({
            code: XmlErrorCodeValue.signFailed,
            retryable: false,
            operation: XmlOperationValue.sign,
          }),
      ),
    );
    yield* xmlRuntime.validateSigningDocument(signedDocument);
    return output;
  });
