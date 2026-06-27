import "reflect-metadata";
import { X509Certificate } from "@peculiar/x509";
import { base64ToBytes } from "@signature-kit/crypto/base64";
import type { SignatureAlgorithm } from "@signature-kit/core/config";
import { Effect } from "effect";
import { Parse, SignedXml } from "xmldsigjs";
import {
  type XmlVerificationRequest,
  type XmlVerificationResult,
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
} from "./config";
import { XmlRuntime, toBufferSource, xmlSignatureAlgorithm } from "./engine";

const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

const importVerificationKey = (
  publicKeyDer: Uint8Array,
  algorithm: SignatureAlgorithm,
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
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

const embeddedVerificationKey = (
  signatureElement: Element,
  algorithm: SignatureAlgorithm,
): Effect.Effect<CryptoKey | undefined, XmlError> => {
  const certificateText =
    signatureElement
      .getElementsByTagNameNS(XMLDSIG_NAMESPACE, "X509Certificate")
      .item(0)
      ?.textContent?.replace(/[\t\n\r ]/g, "") ?? "";

  if (certificateText.length === 0) {
    return Effect.succeed(undefined);
  }

  return Effect.tryPromise({
    try: () =>
      new X509Certificate(toBufferSource(base64ToBytes(certificateText))).publicKey.export(
        xmlSignatureAlgorithm(algorithm),
        ["verify"],
      ),
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });
};

export const verifyXml = (
  input: XmlVerificationRequest,
): Effect.Effect<XmlVerificationResult, XmlError, XmlRuntime> =>
  Effect.gen(function* () {
    const xmlRuntime = yield* XmlRuntime;
    yield* xmlRuntime.ensure;
    const algorithm = input.algorithm ?? "rsa-sha256";

    const document = yield* Effect.try({
      try: () => Parse(input.xml),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
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
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
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
        ? yield* embeddedVerificationKey(signatureElement, algorithm)
        : yield* importVerificationKey(input.publicKeyDer, algorithm);

    const valid = yield* Effect.tryPromise({
      try: () => (publicKey === undefined ? signedXml.Verify() : signedXml.Verify(publicKey)),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.verifyFailed,
          retryable: false,
          operation: XmlOperationValue.verify,
        }),
    }).pipe(
      Effect.catchIf(
        (error: XmlError) => error.code === XmlErrorCodeValue.verifyFailed,
        () => Effect.succeed(false),
      ),
    );

    return { valid, signatureCount: signatures.length, referenceUris };
  });
