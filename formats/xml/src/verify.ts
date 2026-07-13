import type { SignatureAlgorithm } from "@signature-kit/signatures";
import { Effect, Schema } from "effect";
import {
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  XmlSchemaNameValue,
  XmlVerificationRequestSchema,
  xmlHashAlgorithmFromSignatureAlgorithm,
} from "./config.js";
import type {
  XmlHashAlgorithm,
  XmlRequiredReference,
  XmlVerificationRequest,
  XmlVerificationResult,
} from "./config.js";
import { XmlRuntime } from "./runtime.js";
import type { XmlRuntimeService, XmlRuntimeSignedXmlConstructor } from "./runtime.js";

const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";
const XML_CORE_CRYPTOGRAPHIC_ERROR_CODE = 13;

const XML_ENVELOPED_SIGNATURE_TRANSFORM = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const XML_CANONICALIZATION_TRANSFORMS: Record<string, true> = {
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315": true,
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments": true,
  "http://www.w3.org/2001/10/xml-exc-c14n#": true,
  "http://www.w3.org/2001/10/xml-exc-c14n#WithComments": true,
  "http://www.w3.org/2006/12/xml-c14n11": true,
  "http://www.w3.org/2006/12/xml-c14n11#WithComments": true,
};

type SignatureVerificationMetadata = {
  readonly signatureElement: Element;
  readonly hash: XmlHashAlgorithm;
};

const XmlCoreErrorSchema = Schema.Struct({
  prefix: Schema.Literal("XMLJS"),
  code: Schema.Number,
  message: Schema.String,
});

const isXmlCoreCryptographicCause = Schema.is(XmlCoreErrorSchema);

const directElementsByName = (
  parent: Element,
  namespaceUri: string | null,
  localName: string,
  maximumCount: number,
): Array<Element> | undefined => {
  const directElements: Array<Element> = [];
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const element = children.item(index);
    if (
      element !== null &&
      element.localName === localName &&
      (element.namespaceURI ?? null) === namespaceUri
    ) {
      if (directElements.length === maximumCount) {
        return undefined;
      }
      directElements.push(element);
    }
  }
  return directElements;
};

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

const importPublicVerificationKey = (
  xmlRuntime: XmlRuntimeService,
  publicKeyDer: Uint8Array,
  hash: XmlHashAlgorithm,
) => xmlRuntime.importVerificationKey(publicKeyDer, xmlVerificationAlgorithm(hash));

const importTrustedCertificateVerificationKey = (
  xmlRuntime: XmlRuntimeService,
  trustedCertificateDer: Uint8Array,
  hash: XmlHashAlgorithm,
) =>
  xmlRuntime.exportCertificateVerificationKey(
    trustedCertificateDer,
    xmlVerificationAlgorithm(hash),
  );

const inferSignatureHashAlgorithm = (
  signedInfoElement: Element,
  referenceElements: ReadonlyArray<Element>,
  fallback: SignatureAlgorithm | undefined,
): XmlHashAlgorithm | undefined => {
  const signatureMethods = directElementsByName(
    signedInfoElement,
    XMLDSIG_NAMESPACE,
    "SignatureMethod",
    1,
  );
  if (signatureMethods === undefined || signatureMethods.length !== 1) {
    return undefined;
  }
  const signatureMethod = signatureMethods[0];
  if (signatureMethod === undefined) {
    return undefined;
  }
  const signatureMethodHash = xmlHashAlgorithmFromString(
    signatureMethod.getAttribute("Algorithm") ?? "",
  );

  if (signatureMethodHash !== undefined) {
    return signatureMethodHash;
  }

  let inferred: XmlHashAlgorithm | undefined;
  for (const reference of referenceElements) {
    const digestMethods = directElementsByName(reference, XMLDSIG_NAMESPACE, "DigestMethod", 1);
    if (digestMethods === undefined || digestMethods.length !== 1) {
      return undefined;
    }
    const digestMethod = digestMethods[0];
    if (digestMethod === undefined) {
      return undefined;
    }
    const current = xmlHashAlgorithmFromString(digestMethod.getAttribute("Algorithm") ?? "");
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

const indexElementsById = (document: Document): Map<string, Set<Element>> => {
  const indexedById = new Map<string, Set<Element>>();
  const elements = document.getElementsByTagName("*");

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements.item(index);
    if (element === null) {
      continue;
    }
    const aliases = new Set([
      element.getAttribute("Id") ?? "",
      element.getAttribute("id") ?? "",
      element.getAttribute("ID") ?? "",
    ]);
    for (const id of aliases) {
      if (id.length === 0) {
        continue;
      }
      const indexedElements = indexedById.get(id);
      if (indexedElements === undefined) {
        indexedById.set(id, new Set([element]));
        continue;
      }
      indexedElements.add(element);
    }
  }

  return indexedById;
};

const isTargetInsideSignature = (target: Element, signatures: ReadonlySet<Element>): boolean => {
  let current: Element | null = target;
  while (current !== null) {
    if (signatures.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

const isTargetAmbiguousOrHidden = (
  uri: string,
  indexedById: Map<string, Set<Element>>,
  signatures: ReadonlySet<Element>,
): boolean => {
  if (uri.length === 0) {
    return false;
  }
  if (uri.length === 1 || !uri.startsWith("#")) {
    return true;
  }
  const matched = indexedById.get(uri.slice(1));
  if (matched === undefined || matched.size !== 1) {
    return true;
  }
  for (const target of matched) {
    return isTargetInsideSignature(target, signatures);
  }
  return true;
};

const isRequiredReferenceAtExpectedLocation = (
  document: Document,
  requiredReference: XmlRequiredReference,
  indexedById: Map<string, Set<Element>>,
  signatures: ReadonlySet<Element>,
): boolean => {
  const root = document.documentElement;
  const rootPathSegment = requiredReference.path[0];
  if (
    root === null ||
    rootPathSegment === undefined ||
    root.localName !== rootPathSegment.localName ||
    (root.namespaceURI ?? null) !== rootPathSegment.namespaceUri
  ) {
    return false;
  }

  let target: Element = root;
  for (let index = 1; index < requiredReference.path.length; index += 1) {
    const pathSegment = requiredReference.path[index];
    if (pathSegment === undefined) {
      return false;
    }
    const matches = directElementsByName(
      target,
      pathSegment.namespaceUri,
      pathSegment.localName,
      1,
    );
    if (matches === undefined || matches.length !== 1) {
      return false;
    }
    const match = matches[0];
    if (match === undefined) {
      return false;
    }
    target = match;
  }

  const uri = requiredReference.uri;
  if (isTargetAmbiguousOrHidden(uri, indexedById, signatures)) {
    return false;
  }
  const indexedTargets = indexedById.get(uri.slice(1));
  if (indexedTargets === undefined || indexedTargets.size !== 1) {
    return false;
  }
  for (const indexedTarget of indexedTargets) {
    return indexedTarget === target;
  }
  return false;
};

const hasSafeRequiredReferenceTransforms = (referenceElement: Element): boolean => {
  const transformsContainers = directElementsByName(
    referenceElement,
    XMLDSIG_NAMESPACE,
    "Transforms",
    1,
  );
  if (transformsContainers === undefined) {
    return false;
  }
  const transformsContainer = transformsContainers[0];
  if (transformsContainer === undefined) {
    return true;
  }
  const transformElements = directElementsByName(
    transformsContainer,
    XMLDSIG_NAMESPACE,
    "Transform",
    3,
  );
  if (transformElements === undefined || transformElements.length === 0) {
    return transformElements !== undefined;
  }
  if (transformElements.length !== 2) {
    return false;
  }
  const envelopedTransform = transformElements[0];
  const canonicalizationTransform = transformElements[1];
  return (
    envelopedTransform !== undefined &&
    canonicalizationTransform !== undefined &&
    envelopedTransform.getAttribute("Algorithm") === XML_ENVELOPED_SIGNATURE_TRANSFORM &&
    XML_CANONICALIZATION_TRANSFORMS[canonicalizationTransform.getAttribute("Algorithm") ?? ""] ===
      true
  );
};

const verifySingleSignature = (
  document: Document,
  signatureElement: Element,
  publicKey: CryptoKey,
  SignedXml: XmlRuntimeSignedXmlConstructor,
): Effect.Effect<boolean, XmlError> =>
  Effect.gen(function* () {
    const signedXml = new SignedXml(document);
    yield* Effect.try({
      try: () => signedXml.LoadXml(signatureElement),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.verifyFailed,
          retryable: false,
          operation: XmlOperationValue.verify,
        }),
    });

    return yield* Effect.tryPromise({
      try: () => signedXml.Verify(publicKey),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        isXmlCoreCryptographicCause(cause) && cause.code === XML_CORE_CRYPTOGRAPHIC_ERROR_CODE
          ? Effect.succeed(false)
          : Effect.fail(
              new XmlError({
                code: XmlErrorCodeValue.verifyFailed,
                retryable: false,
                operation: XmlOperationValue.verify,
              }),
            ),
      ),
    );
  });

export const verifyXml = (
  request: XmlVerificationRequest,
): Effect.Effect<XmlVerificationResult, XmlError, XmlRuntime> =>
  Effect.gen(function* () {
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
    const xmlRuntime = yield* XmlRuntime;
    const signatureHashFallback = input.algorithm;
    const document = yield* xmlRuntime.parse(input.xml);
    yield* xmlRuntime.validateSignatureTransforms(document);

    const signatureStructure = xmlRuntime.inspectSignatureStructure(document);
    const signatureCount = signatureStructure.signatureCount;
    if (signatureCount === 0) {
      return yield* Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.signatureNotFound,
          retryable: false,
          reason: "No XMLDSig Signature element found.",
          operation: XmlOperationValue.verify,
        }),
      );
    }

    const signatureElements = signatureStructure.signatureElements;
    const signatureElementSet = new Set(signatureElements);
    const indexedById = indexElementsById(document);
    const referenceUris = [...signatureStructure.referenceUris];
    const invalidResult: XmlVerificationResult = {
      valid: false,
      signatureCount,
      referenceUris,
    };
    if (!signatureStructure.valid) {
      return invalidResult;
    }

    const verificationMetadata: Array<SignatureVerificationMetadata> = [];
    let metadataValid = true;
    let requiredReferenceTransformsValid = true;

    for (const signatureElement of signatureElements) {
      const signedInfos = directElementsByName(
        signatureElement,
        XMLDSIG_NAMESPACE,
        "SignedInfo",
        1,
      );
      const signedInfo = signedInfos?.[0];
      if (signedInfos === undefined || signedInfos.length !== 1 || signedInfo === undefined) {
        metadataValid = false;
        continue;
      }
      const referenceElements = directElementsByName(
        signedInfo,
        XMLDSIG_NAMESPACE,
        "Reference",
        Number.MAX_SAFE_INTEGER,
      );
      if (referenceElements === undefined || referenceElements.length === 0) {
        metadataValid = false;
        continue;
      }
      if (
        referenceElements.some((referenceElement) =>
          isTargetAmbiguousOrHidden(
            referenceElement.getAttribute("URI") ?? "",
            indexedById,
            signatureElementSet,
          ),
        )
      ) {
        metadataValid = false;
        continue;
      }
      if (
        input.requiredReference !== undefined &&
        referenceElements.some(
          (referenceElement) =>
            referenceElement.getAttribute("URI") === input.requiredReference?.uri &&
            !hasSafeRequiredReferenceTransforms(referenceElement),
        )
      ) {
        requiredReferenceTransformsValid = false;
      }

      const hash = inferSignatureHashAlgorithm(
        signedInfo,
        referenceElements,
        signatureHashFallback,
      );
      if (hash === undefined) {
        metadataValid = false;
        continue;
      }
      verificationMetadata.push({ signatureElement, hash });
    }

    if (
      !metadataValid ||
      !requiredReferenceTransformsValid ||
      (input.requiredReference !== undefined &&
        (!isRequiredReferenceAtExpectedLocation(
          document,
          input.requiredReference,
          indexedById,
          signatureElementSet,
        ) ||
          !referenceUris.includes(input.requiredReference.uri))) ||
      (input.publicKeyDer === undefined && input.trustedCertificateDer === undefined)
    ) {
      return invalidResult;
    }

    const SignedXml = yield* xmlRuntime.signedXml();
    for (const metadata of verificationMetadata) {
      const publicKey =
        input.publicKeyDer !== undefined
          ? yield* importPublicVerificationKey(xmlRuntime, input.publicKeyDer, metadata.hash)
          : input.trustedCertificateDer !== undefined
            ? yield* importTrustedCertificateVerificationKey(
                xmlRuntime,
                input.trustedCertificateDer,
                metadata.hash,
              )
            : undefined;
      if (publicKey === undefined) {
        return invalidResult;
      }
      const valid = yield* verifySingleSignature(
        document,
        metadata.signatureElement,
        publicKey,
        SignedXml,
      );
      if (!valid) {
        return invalidResult;
      }
    }

    return {
      valid: true,
      signatureCount,
      referenceUris,
    };
  });
