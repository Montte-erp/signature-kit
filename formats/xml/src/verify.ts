import { Effect } from "effect";
import { Parse, SignedXml } from "xmldsigjs";
import {
  type XmlVerificationRequest,
  type XmlVerificationResult,
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  safeCauseMetadata,
} from "./config";
import { ensureXmlRuntime, toBufferSource, xmlSignatureAlgorithm } from "./engine";

const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

const importVerificationKey = (
  publicKeyDer: Uint8Array,
  algorithm: "rsa-sha256" | "rsa-sha512",
): Effect.Effect<CryptoKey, XmlError> =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "spki",
        toBufferSource(publicKeyDer),
        xmlSignatureAlgorithm(algorithm),
        true,
        ["verify"],
      ),
    catch: (cause) =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
        ...safeCauseMetadata(cause),
      }),
  });

const isVerificationMismatch = (error: XmlError): boolean =>
  error.code === XmlErrorCodeValue.verifyFailed &&
  (error.reason?.includes("Invalid digest") === true ||
    error.reason?.includes("Invalid signature") === true);

export const verifyXml = (
  input: XmlVerificationRequest,
): Effect.Effect<XmlVerificationResult, XmlError> =>
  Effect.gen(function* () {
    yield* ensureXmlRuntime();
    const algorithm = input.algorithm ?? "rsa-sha256";

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

    const signatures = document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Signature");
    const signatureElement = signatures.item(0);
    if (signatureElement === null) {
      return yield* Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.signatureNotFound,
          retryable: false,
          reason: "No XMLDSig Signature element found.",
          operation: XmlOperationValue.verify,
        }),
      );
    }

    const signedXml = new SignedXml(document);
    yield* Effect.try({
      try: () => signedXml.LoadXml(signatureElement),
      catch: (cause) =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
          ...safeCauseMetadata(cause),
        }),
    });

    const referenceUris = signedXml.XmlSignature.SignedInfo.References.GetIterator().map(
      (reference) => reference.Uri ?? "",
    );
    if (
      input.requireReferenceUri !== undefined &&
      !referenceUris.includes(input.requireReferenceUri)
    ) {
      return { valid: false, signatureCount: signatures.length, referenceUris };
    }

    const publicKey =
      input.publicKeyDer === undefined
        ? undefined
        : yield* importVerificationKey(input.publicKeyDer, algorithm);

    const valid = yield* Effect.tryPromise({
      try: () => (publicKey === undefined ? signedXml.Verify() : signedXml.Verify(publicKey)),
      catch: (cause) =>
        new XmlError({
          code: XmlErrorCodeValue.verifyFailed,
          retryable: false,
          operation: XmlOperationValue.verify,
          ...safeCauseMetadata(cause),
        }),
    }).pipe(Effect.catchIf(isVerificationMismatch, () => Effect.succeed(false)));

    return { valid, signatureCount: signatures.length, referenceUris };
  });
