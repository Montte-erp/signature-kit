import "reflect-metadata";
import { X509Certificate } from "@peculiar/x509";
import type { SignatureAlgorithm } from "@signature-kit/core/config";
import { Effect, Schema } from "effect";
import { SignedXml } from "xmldsigjs";
import {
  type XmlVerificationRequest,
  type XmlVerificationResult,
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  XmlSchemaNameValue,
  XmlVerificationRequestSchema,
} from "./config";
import { XmlRuntime } from "./runtime";

const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

type XmlHashAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

const xmlVerificationAlgorithm = (hash: XmlHashAlgorithm): RsaHashedImportParams => ({
  name: XML_RSA_ALGORITHM_NAME,
  hash,
});

const xmlHashAlgorithmFromString = (value: string): XmlHashAlgorithm | undefined => {
  const normalized = value.toLowerCase();
  if (normalized.includes("sha1") || normalized.includes("sha-1")) {
    return "SHA-1";
  }
  if (normalized.includes("sha512") || normalized.includes("sha-512")) {
    return "SHA-512";
  }
  if (normalized.includes("sha256") || normalized.includes("sha-256")) {
    return "SHA-256";
  }
  return undefined;
};

const xmlHashAlgorithmFromSignatureAlgorithm = (
  algorithm: SignatureAlgorithm,
): XmlHashAlgorithm => {
  switch (algorithm) {
    case "rsa-sha1":
      return "SHA-1";
    case "rsa-sha512":
      return "SHA-512";
    case "rsa-sha256":
      return "SHA-256";
  }
};

const importPublicVerificationKey = (publicKeyDer: Uint8Array, hash: XmlHashAlgorithm) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "spki",
        new Uint8Array(publicKeyDer),
        xmlVerificationAlgorithm(hash),
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

const importTrustedCertificateVerificationKey = (
  trustedCertificateDer: Uint8Array,
  hash: XmlHashAlgorithm,
) =>
  Effect.tryPromise({
    try: () => {
      const certificateBytes = new ArrayBuffer(trustedCertificateDer.byteLength);
      new Uint8Array(certificateBytes).set(trustedCertificateDer);
      return new X509Certificate(certificateBytes).publicKey.export(
        xmlVerificationAlgorithm(hash),
        ["verify"],
      );
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

const inferSignatureHashAlgorithm = (
  signatureElement: Element,
  fallback: SignatureAlgorithm | undefined,
): XmlHashAlgorithm | undefined => {
  const signatureMethodUri = signatureElement
    .getElementsByTagNameNS(XMLDSIG_NAMESPACE, "SignatureMethod")
    .item(0)
    ?.getAttribute("Algorithm");
  const signatureMethodHash =
    signatureMethodUri === undefined || signatureMethodUri === null
      ? undefined
      : xmlHashAlgorithmFromString(signatureMethodUri);

  if (signatureMethodHash !== undefined) {
    return signatureMethodHash;
  }

  const digestMethodNodes = signatureElement.getElementsByTagNameNS(
    XMLDSIG_NAMESPACE,
    "DigestMethod",
  );
  let inferred: XmlHashAlgorithm | undefined;
  for (let index = 0; index < digestMethodNodes.length; index += 1) {
    const digestMethodNode = digestMethodNodes.item(index);
    if (digestMethodNode === null) {
      continue;
    }
    const digestMethodUri = digestMethodNode.getAttribute("Algorithm") ?? "";
    const current = xmlHashAlgorithmFromString(digestMethodUri);
    if (current === undefined) {
      continue;
    }
    if (inferred === undefined) {
      inferred = current;
      continue;
    }
    if (inferred !== current) {
      return undefined;
    }
  }

  return (
    inferred ??
    (fallback === undefined ? undefined : xmlHashAlgorithmFromSignatureAlgorithm(fallback))
  );
};

const indexElementsById = (document: Document): Map<string, Array<Element>> => {
  const indexedById = new Map<string, Array<Element>>();
  const elements = document.getElementsByTagName("*");

  const add = (element: Element, id: string): void => {
    if (id.length === 0) {
      return;
    }
    const existing = indexedById.get(id);
    if (existing === undefined) {
      indexedById.set(id, [element]);
      return;
    }
    existing.push(element);
  };

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements.item(index);
    if (element === null) {
      continue;
    }
    const idAttr = element.getAttribute("Id") ?? "";
    add(element, idAttr);
    add(element, element.getAttribute("id") ?? "");
    add(element, element.getAttribute("ID") ?? "");
  }

  return indexedById;
};

const isTargetAmbiguousOrHidden = (
  uri: string,
  indexedById: Map<string, Array<Element>>,
  signatures: ReadonlyArray<Element>,
): boolean => {
  if (uri.length === 0) {
    return false;
  }
  if (uri.length === 1 || !uri.startsWith("#")) {
    return true;
  }
  const id = uri.slice(1);
  const matched = indexedById.get(id) ?? [];
  if (matched.length !== 1) {
    return true;
  }
  const target = matched[0];
  if (target === undefined) {
    return true;
  }
  return signatures.some((signature) => signature === target || signature.contains(target));
};

const collectSignatureReferences = (signatureElement: Element): Array<string> => {
  const references = signatureElement.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Reference");
  const values: Array<string> = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = references.item(index);
    values.push(reference?.getAttribute("URI") ?? "");
  }
  return values;
};

const verifySingleSignature = (
  document: Document,
  signatureElement: Element,
  publicKey: CryptoKey,
): Effect.Effect<boolean, never, never> => {
  const signedXml = new SignedXml(document);
  return Effect.try({
    try: () => signedXml.LoadXml(signatureElement),
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.verifyFailed,
        retryable: false,
        operation: XmlOperationValue.verify,
      }),
  }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => signedXml.Verify(publicKey),
        catch: () =>
          new XmlError({
            code: XmlErrorCodeValue.verifyFailed,
            retryable: false,
            operation: XmlOperationValue.verify,
          }),
      }),
    ),
    Effect.catch(() => Effect.succeed(false)),
  );
};

export const verifyXml = (
  request: XmlVerificationRequest,
): Effect.Effect<XmlVerificationResult, XmlError, XmlRuntime> =>
  Effect.gen(function* () {
    const xmlRuntime = yield* XmlRuntime;
    const input = yield* Schema.decodeUnknownEffect(XmlVerificationRequestSchema)(request).pipe(
      Effect.mapError(
        (issue) =>
          new XmlError({
            code: XmlErrorCodeValue.invalidInput,
            retryable: false,
            operation: XmlOperationValue.verify,
            schemaName: XmlSchemaNameValue.verificationRequest,
            issueMessage: String(issue),
          }),
      ),
    );
    const signatureHashFallback = input.algorithm;

    const document = yield* xmlRuntime.parse(input.xml);

    const signatureNodeList = document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Signature");
    if (signatureNodeList.length === 0) {
      return yield* Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.signatureNotFound,
          retryable: false,
          reason: "No XMLDSig Signature element found.",
          operation: XmlOperationValue.verify,
        }),
      );
    }

    const signatureElements: Array<Element> = [];
    for (let index = 0; index < signatureNodeList.length; index += 1) {
      const signatureElement = signatureNodeList.item(index);
      if (signatureElement !== null) {
        signatureElements.push(signatureElement);
      }
    }

    const indexedById = indexElementsById(document);
    let valid = true;
    const referenceUris: Array<string> = [];

    for (let index = 0; index < signatureElements.length; index += 1) {
      const signatureElement = signatureElements[index];
      if (signatureElement === undefined) {
        continue;
      }

      const references = collectSignatureReferences(signatureElement);
      referenceUris.push(...references);
      const hasInvalidReference = references.some((uri) =>
        isTargetAmbiguousOrHidden(uri, indexedById, signatureElements),
      );
      if (hasInvalidReference || references.length === 0) {
        valid = false;
        continue;
      }

      const hash = inferSignatureHashAlgorithm(signatureElement, signatureHashFallback);
      if (hash === undefined) {
        valid = false;
        continue;
      }

      const publicKey =
        input.publicKeyDer !== undefined
          ? yield* importPublicVerificationKey(input.publicKeyDer, hash)
          : input.trustedCertificateDer !== undefined
            ? yield* importTrustedCertificateVerificationKey(input.trustedCertificateDer, hash)
            : undefined;
      if (publicKey === undefined) {
        valid = false;
        continue;
      }

      const singleSignatureValid = yield* verifySingleSignature(
        document,
        signatureElement,
        publicKey,
      );
      if (!singleSignatureValid) {
        valid = false;
      }
    }

    if (
      input.requireReferenceUri !== undefined &&
      !referenceUris.includes(input.requireReferenceUri)
    ) {
      valid = false;
    }

    return {
      valid,
      signatureCount: signatureElements.length,
      referenceUris,
    };
  });
