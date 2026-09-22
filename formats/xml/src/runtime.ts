import "reflect-metadata";
import { X509Certificate } from "@peculiar/x509";
import { bytesToBase64, base64ToBytes } from "@signature-kit/crypto/base64";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Cache, Context, Effect, Layer } from "effect";
import { Application, SignedXml } from "xmldsigjs";
import type {
  DigestReferenceSource,
  OptionsSign,
  OptionsVerify,
  Signature as XmlDsigSignature,
} from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config.js";
import type { XmlVerificationKeySource } from "./config.js";

declare module "@xmldom/xmldom" {
  interface DOMParser {
    parseFromString(source: string, mimeType: "application/xml"): globalThis.Document;
  }
}

const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const XMLDSIG_XPATH_TRANSFORM = "http://www.w3.org/TR/1999/REC-xpath-19991116";
const MAXIMUM_SIGNATURE_COUNT = 4;
const MAXIMUM_REFERENCES_PER_SIGNATURE = 4;
const MAXIMUM_TOTAL_REFERENCE_COUNT = 8;
const MAXIMUM_TRANSFORMS_PER_REFERENCE = 3;
const MAXIMUM_TOTAL_TRANSFORM_COUNT = 8;
const MAXIMUM_TOTAL_CANONICALIZATION_TRANSFORM_COUNT = MAXIMUM_TOTAL_REFERENCE_COUNT;
const MAXIMUM_XML_CHARACTER_COUNT = 10 * 1024 * 1024;
const MAXIMUM_XML_TREE_DEPTH = 1024;
const XML_NAMESPACE_DECLARATION_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const XML_EXCLUSIVE_C14N_TRANSFORM = "http://www.w3.org/2001/10/xml-exc-c14n#";
const XML_EXCLUSIVE_C14N_WITH_COMMENTS_TRANSFORM =
  "http://www.w3.org/2001/10/xml-exc-c14n#WithComments";
const MAXIMUM_XML_NODE_COUNT = 16_384;
const MAXIMUM_XML_ATTRIBUTE_COUNT = 2_048;
const MAXIMUM_XML_NAMESPACE_DECLARATION_COUNT = 64;
const MAXIMUM_INCLUSIVE_NAMESPACE_PREFIX_LIST_LENGTH = 4_096;
const MAXIMUM_INCLUSIVE_NAMESPACE_PREFIX_COUNT = 64;
const XML_ONE_DECLARATION_PATTERN =
  /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>$/;

type XmlVerificationKeyCacheKey = {
  readonly source: XmlVerificationKeySource;
  readonly derBase64: string;
  readonly algorithmName: string;
  readonly algorithmHash: string;
};

export type XmlSignatureStructure = {
  readonly signatureCount: number;
  readonly signatureElements: ReadonlyArray<Element>;
  readonly referenceUris: ReadonlyArray<string>;
  readonly valid: boolean;
  readonly canAppendSignature: boolean;
};

export type XmlRuntimeService = {
  readonly parse: (xml: string) => Effect.Effect<Document, XmlError>;
  readonly signedXml: () => Effect.Effect<XmlRuntimeSignedXmlConstructor, XmlError>;
  readonly validateSignatureTransforms: (document: Document) => Effect.Effect<void, XmlError>;
  readonly inspectSignatureStructure: (document: Document) => XmlSignatureStructure;
  readonly validateSigningDocument: (
    document: Document,
  ) => Effect.Effect<XmlSignatureStructure, XmlError>;
  readonly importVerificationKey: (
    publicKeyDer: Uint8Array,
    algorithm: RsaHashedImportParams,
  ) => Effect.Effect<CryptoKey, XmlError>;
  readonly exportCertificateVerificationKey: (
    certificateDer: Uint8Array,
    algorithm: RsaHashedImportParams,
  ) => Effect.Effect<CryptoKey, XmlError>;
};

class XmlRuntimeSignedXml extends SignedXml {
  private hasXPathTransform(): boolean {
    const references = this.XmlSignature.SignedInfo.References;
    if (references === undefined) {
      return false;
    }

    for (const reference of references.GetIterator()) {
      const transforms = reference.Transforms;
      if (transforms === undefined) {
        continue;
      }
      for (const transform of transforms.GetIterator()) {
        if (transform.Algorithm === XMLDSIG_XPATH_TRANSFORM) {
          return true;
        }
      }
    }

    return false;
  }

  private hasExcessiveInclusiveNamespacePrefixList(): boolean {
    const signature = this.GetXml();
    return signature !== null && containsExcessiveInclusiveNamespacePrefixList(signature);
  }

  override Sign(
    algorithm: Algorithm | EcdsaParams | RsaPssParams,
    key: CryptoKey,
    data: Document | DigestReferenceSource,
    options?: OptionsSign,
  ): Promise<XmlDsigSignature> {
    const hasXPathTransform =
      this.hasXPathTransform() ||
      (options?.references?.some(
        (reference) =>
          reference.transforms?.some(
            (transform) =>
              transform === XMLDSIG_XPATH_TRANSFORM ||
              (typeof transform !== "string" && transform.name === "xpath"),
          ) ?? false,
      ) ??
        false);
    if (hasXPathTransform) {
      return Promise.reject(
        new XmlError({
          code: XmlErrorCodeValue.unsupportedAlgorithm,
          retryable: false,
          reason: "XPath XMLDSig transforms are not supported.",
          operation: XmlOperationValue.sign,
        }),
      );
    }

    if (this.hasExcessiveInclusiveNamespacePrefixList()) {
      return Promise.reject(
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          reason: "XML canonicalization parameters exceed runtime limits.",
          operation: XmlOperationValue.sign,
        }),
      );
    }

    return super.Sign(algorithm, key, data, options);
  }

  override Verify(params?: CryptoKey | OptionsVerify): Promise<boolean> {
    if (this.hasXPathTransform()) {
      return Promise.reject(
        new XmlError({
          code: XmlErrorCodeValue.unsupportedAlgorithm,
          retryable: false,
          reason: "XPath XMLDSig transforms are not supported.",
          operation: XmlOperationValue.verify,
        }),
      );
    }

    if (this.hasExcessiveInclusiveNamespacePrefixList()) {
      return Promise.reject(
        new XmlError({
          code: XmlErrorCodeValue.verifyFailed,
          retryable: false,
          reason: "XML canonicalization parameters exceed runtime limits.",
          operation: XmlOperationValue.verify,
        }),
      );
    }

    return super.Verify(params);
  }
}

export type XmlRuntimeSignedXmlConstructor = typeof XmlRuntimeSignedXml;

export class XmlRuntime extends Context.Service<XmlRuntime, XmlRuntimeService>()(
  "@signature-kit/xml/Runtime",
) {}

const algorithmHashName = (algorithm: RsaHashedImportParams): string =>
  typeof algorithm.hash === "string" ? algorithm.hash : algorithm.hash.name;

const verificationKeyCacheKey = (
  source: XmlVerificationKeySource,
  der: Uint8Array,
  algorithm: RsaHashedImportParams,
): XmlVerificationKeyCacheKey => ({
  source,
  derBase64: bytesToBase64(der),
  algorithmName: algorithm.name,
  algorithmHash: algorithmHashName(algorithm),
});

const verificationAlgorithm = (key: XmlVerificationKeyCacheKey): RsaHashedImportParams => ({
  name: key.algorithmName,
  hash: key.algorithmHash,
});

const configureXmlRuntime: Effect.Effect<void, XmlError> = Effect.suspend(() => {
  if (globalThis.crypto === undefined) {
    return Effect.fail(
      new XmlError({
        code: XmlErrorCodeValue.runtimeUnavailable,
        retryable: false,
        reason: "Web Crypto is not available in this runtime.",
        operation: XmlOperationValue.runtime,
      }),
    );
  }

  return Effect.try({
    try: () => {
      Application.setEngine("signature-kit", globalThis.crypto);
      setNodeDependencies({ DOMImplementation, DOMParser, XMLSerializer });
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.runtimeUnavailable,
        retryable: false,
        reason: "XML runtime setup failed.",
        operation: XmlOperationValue.runtime,
      }),
  });
});

const isXmlOneCodePoint = (codePoint: number): boolean =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff);

const containsInvalidXmlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        return true;
      }
      const codePoint = 0x10000 + (code - 0xd800) * 0x400 + (trailing - 0xdc00);
      if (!isXmlOneCodePoint(codePoint)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
    if (!isXmlOneCodePoint(code)) {
      return true;
    }
  }

  return false;
};

const containsInvalidNumericCharacterReference = (xml: string): boolean => {
  let index = 0;

  while (index < xml.length) {
    if (xml.startsWith("<!--", index)) {
      const closing = xml.indexOf("-->", index + 4);
      if (closing === -1) {
        return false;
      }
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", index)) {
      const closing = xml.indexOf("]]>", index + 9);
      if (closing === -1) {
        return false;
      }
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", index)) {
      const closing = xml.indexOf("?>", index + 2);
      if (closing === -1) {
        return false;
      }
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<!DOCTYPE", index)) {
      return false;
    }
    if (xml[index] !== "&" || xml[index + 1] !== "#") {
      index += 1;
      continue;
    }

    let radix = 10;
    let digitIndex = index + 2;
    if (xml[digitIndex] === "x" || xml[digitIndex] === "X") {
      radix = 16;
      digitIndex += 1;
    }
    let value = 0;
    let hasDigits = false;
    while (digitIndex < xml.length && xml[digitIndex] !== ";") {
      const code = xml.charCodeAt(digitIndex);
      let digit = -1;
      if (code >= 0x30 && code <= 0x39) {
        digit = code - 0x30;
      } else if (code >= 0x41 && code <= 0x46) {
        digit = code - 0x41 + 10;
      } else if (code >= 0x61 && code <= 0x66) {
        digit = code - 0x61 + 10;
      }
      if (digit < 0 || digit >= radix) {
        return true;
      }
      hasDigits = true;
      if (value > Math.floor((0x10ffff - digit) / radix)) {
        return true;
      }
      value = value * radix + digit;
      digitIndex += 1;
    }
    if (
      !hasDigits ||
      digitIndex >= xml.length ||
      xml[digitIndex] !== ";" ||
      !isXmlOneCodePoint(value)
    ) {
      return true;
    }
    index = digitIndex + 1;
  }

  return false;
};

const hasNonXmlWhitespace = (
  value: string,
  start: number,
  end: number,
  allowInitialByteOrderMark: boolean,
): boolean => {
  for (let index = start; index < end; index += 1) {
    const character = value[index];
    if (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      (allowInitialByteOrderMark && index === 0 && character === "\ufeff")
    ) {
      continue;
    }
    return true;
  }

  return false;
};

const hasInvalidXmlDocumentFraming = (xml: string): boolean => {
  let elementDepth = 0;
  let rootSeen = false;
  let index = 0;

  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    const textEnd = opening === -1 ? xml.length : opening;
    if (elementDepth === 0 && hasNonXmlWhitespace(xml, index, textEnd, true)) {
      return true;
    }
    if (opening === -1) {
      break;
    }

    const marker = xml[opening + 1];
    if (marker === undefined) {
      return true;
    }
    if (marker === "/") {
      const closing = xml.indexOf(">", opening + 2);
      if (closing === -1 || elementDepth === 0) {
        return true;
      }
      elementDepth -= 1;
      index = closing + 1;
      continue;
    }
    if (marker === "?") {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing === -1) {
        return true;
      }
      if (elementDepth === 0) {
        let targetEnd = opening + 2;
        while (targetEnd < closing) {
          const character = xml[targetEnd];
          if (character === " " || character === "\t" || character === "\n" || character === "\r") {
            break;
          }
          targetEnd += 1;
        }
        const target = xml.slice(opening + 2, targetEnd);
        if (rootSeen || target !== "xml" || opening !== (xml.charCodeAt(0) === 0xfeff ? 1 : 0)) {
          return true;
        }
      }
      index = closing + 2;
      continue;
    }
    if (marker === "!") {
      if (xml.startsWith("<!--", opening)) {
        if (elementDepth === 0) {
          return true;
        }
        const closing = xml.indexOf("-->", opening + 4);
        if (closing === -1) {
          return true;
        }
        index = closing + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", opening)) {
        if (elementDepth === 0) {
          return true;
        }
        const closing = xml.indexOf("]]>", opening + 9);
        if (closing === -1) {
          return true;
        }
        index = closing + 3;
        continue;
      }
      return true;
    }

    let quote: string | undefined;
    let closed = false;
    let lastNonWhitespaceCharacter = "";
    for (let tagIndex = opening + 1; tagIndex < xml.length; tagIndex += 1) {
      const character = xml[tagIndex];
      if (character === undefined) {
        return true;
      }
      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ">") {
        closed = true;
        index = tagIndex + 1;
        break;
      }
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") {
        lastNonWhitespaceCharacter = character;
      }
    }
    if (!closed) {
      return true;
    }
    if (elementDepth === 0) {
      if (rootSeen) {
        return true;
      }
      rootSeen = true;
    }
    if (lastNonWhitespaceCharacter !== "/") {
      elementDepth += 1;
    }
  }

  return !rootSeen || elementDepth !== 0;
};

const exceedsXmlLexicalLimits = (xml: string): boolean => {
  let attributeCount = 0;
  let nodeCount = 0;
  let index = 0;

  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening === -1) {
      return false;
    }

    const marker = xml[opening + 1];
    if (marker === undefined) {
      return true;
    }
    if (marker === "/") {
      index = opening + 2;
      continue;
    }
    if (marker === "?") {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing === -1) {
        return true;
      }
      let targetEnd = opening + 2;
      while (targetEnd < closing) {
        const character = xml[targetEnd];
        if (character === " " || character === "\t" || character === "\n" || character === "\r") {
          break;
        }
        targetEnd += 1;
      }
      const target = xml.slice(opening + 2, targetEnd);
      if (
        target.toLowerCase() === "xml" &&
        (opening !== (xml.charCodeAt(0) === 0xfeff ? 1 : 0) ||
          !XML_ONE_DECLARATION_PATTERN.test(xml.slice(opening, closing + 2)))
      ) {
        return true;
      }
      nodeCount += 1;
      if (nodeCount > MAXIMUM_XML_NODE_COUNT) {
        return true;
      }
      index = closing + 2;
      continue;
    }
    if (marker === "!") {
      if (xml.startsWith("<!--", opening)) {
        const closing = xml.indexOf("-->", opening + 4);
        if (closing === -1) {
          return true;
        }
        nodeCount += 1;
        if (nodeCount > MAXIMUM_XML_NODE_COUNT) {
          return true;
        }
        index = closing + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", opening)) {
        const closing = xml.indexOf("]]>", opening + 9);
        if (closing === -1) {
          return true;
        }
        nodeCount += 1;
        if (nodeCount > MAXIMUM_XML_NODE_COUNT) {
          return true;
        }
        index = closing + 3;
        continue;
      }
      return true;
    }

    nodeCount += 1;
    if (nodeCount > MAXIMUM_XML_NODE_COUNT) {
      return true;
    }

    let quote: string | undefined;
    let closed = false;
    for (index = opening + 1; index < xml.length; index += 1) {
      const character = xml[index];
      if (character === undefined) {
        return true;
      }
      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "=") {
        attributeCount += 1;
        if (attributeCount > MAXIMUM_XML_ATTRIBUTE_COUNT) {
          return true;
        }
        continue;
      }
      if (character === ">") {
        closed = true;
        index += 1;
        break;
      }
    }
    if (!closed) {
      return true;
    }
  }

  return false;
};

const isXmlElementNode = (node: Node): node is Element => node.nodeType === 1;

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

const inspectSignatureStructure = (document: Document): XmlSignatureStructure => {
  const signatureNodeList = document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Signature");
  const signatureCount = signatureNodeList.length;
  if (signatureCount > MAXIMUM_SIGNATURE_COUNT) {
    return {
      signatureCount,
      signatureElements: [],
      referenceUris: [],
      valid: false,
      canAppendSignature: false,
    };
  }

  const signatureElements: Array<Element> = [];
  for (let index = 0; index < signatureCount; index += 1) {
    const signatureElement = signatureNodeList.item(index);
    if (signatureElement !== null) {
      signatureElements.push(signatureElement);
    }
  }
  const indexedById = indexElementsById(document);
  const signatureElementSet = new Set(signatureElements);

  const referenceUris: Array<string> = [];
  let totalReferenceCount = 0;
  let totalTransformCount = 0;
  let totalCanonicalizationTransformCount = 0;
  let valid = signatureElements.length === signatureCount;

  for (const signatureElement of signatureElements) {
    const signedInfos = directElementsByName(signatureElement, XMLDSIG_NAMESPACE, "SignedInfo", 1);
    if (signedInfos === undefined || signedInfos.length !== 1) {
      valid = false;
      continue;
    }
    const signedInfo = signedInfos[0];
    if (signedInfo === undefined) {
      valid = false;
      continue;
    }
    const signatureMethods = directElementsByName(
      signedInfo,
      XMLDSIG_NAMESPACE,
      "SignatureMethod",
      1,
    );
    if (signatureMethods === undefined || signatureMethods.length !== 1) {
      valid = false;
      continue;
    }
    const referenceElements = directElementsByName(
      signedInfo,
      XMLDSIG_NAMESPACE,
      "Reference",
      MAXIMUM_REFERENCES_PER_SIGNATURE,
    );
    if (referenceElements === undefined || referenceElements.length === 0) {
      valid = false;
      continue;
    }
    if (totalReferenceCount + referenceElements.length > MAXIMUM_TOTAL_REFERENCE_COUNT) {
      valid = false;
      continue;
    }
    totalReferenceCount += referenceElements.length;

    let signatureTransformsValid = true;
    let signatureTargetsValid = true;
    for (const referenceElement of referenceElements) {
      const referenceUri = referenceElement.getAttribute("URI") ?? "";
      referenceUris.push(referenceUri);
      if (isTargetAmbiguousOrHidden(referenceUri, indexedById, signatureElementSet)) {
        signatureTargetsValid = false;
      }
      const transformsContainers = directElementsByName(
        referenceElement,
        XMLDSIG_NAMESPACE,
        "Transforms",
        1,
      );
      if (transformsContainers === undefined) {
        signatureTransformsValid = false;
        continue;
      }
      const transformsContainer = transformsContainers[0];
      if (transformsContainer === undefined) {
        continue;
      }
      const transformElements = directElementsByName(
        transformsContainer,
        XMLDSIG_NAMESPACE,
        "Transform",
        MAXIMUM_TRANSFORMS_PER_REFERENCE,
      );
      if (transformElements === undefined) {
        signatureTransformsValid = false;
        continue;
      }
      let canonicalizationTransformCount = 0;
      for (const transformElement of transformElements) {
        const algorithm = transformElement.getAttribute("Algorithm") ?? "";
        if (algorithm.toLowerCase().includes("c14n")) {
          canonicalizationTransformCount += 1;
        }
      }
      if (
        canonicalizationTransformCount > 1 ||
        totalTransformCount + transformElements.length > MAXIMUM_TOTAL_TRANSFORM_COUNT ||
        totalCanonicalizationTransformCount + canonicalizationTransformCount >
          MAXIMUM_TOTAL_CANONICALIZATION_TRANSFORM_COUNT
      ) {
        signatureTransformsValid = false;
        continue;
      }
      totalTransformCount += transformElements.length;
      totalCanonicalizationTransformCount += canonicalizationTransformCount;
    }
    if (!signatureTransformsValid || !signatureTargetsValid) {
      valid = false;
    }
  }

  return {
    signatureCount,
    signatureElements,
    referenceUris,
    valid,
    canAppendSignature: signatureCount < MAXIMUM_SIGNATURE_COUNT,
  };
};

const hasInvalidXmlDocumentChildren = (document: Document): boolean => {
  let canAcceptXmlDeclaration = true;
  let elementCount = 0;

  for (let child = document.firstChild; child !== null; child = child.nextSibling) {
    if (isXmlElementNode(child)) {
      elementCount += 1;
      canAcceptXmlDeclaration = false;
      continue;
    }
    if (child.nodeType === 3) {
      const value = child.nodeValue;
      if (typeof value !== "string") {
        return true;
      }
      if (canAcceptXmlDeclaration && value[0] === "\ufeff") {
        if (hasNonXmlWhitespace(value, 1, value.length, false)) {
          return true;
        }
        canAcceptXmlDeclaration = value.length === 1;
        continue;
      }
      if (hasNonXmlWhitespace(value, 0, value.length, false)) {
        return true;
      }
      canAcceptXmlDeclaration = false;
      continue;
    }
    if (child.nodeType === 7 && canAcceptXmlDeclaration && child.nodeName === "xml") {
      canAcceptXmlDeclaration = false;
      continue;
    }
    return true;
  }

  return elementCount !== 1;
};

const exceedsXmlStructuralLimits = (document: Document): boolean => {
  const nodes: Array<{ readonly depth: number; readonly node: Node }> = [
    { depth: 0, node: document },
  ];
  let namespaceDeclarationCount = 0;
  let nodeCount = 0;

  while (nodes.length > 0) {
    const current = nodes.pop();
    if (current === undefined) {
      continue;
    }
    const nodeValue = current.node.nodeValue;
    if (typeof nodeValue === "string" && containsInvalidXmlCharacter(nodeValue)) {
      return true;
    }
    nodeCount += 1;
    if (nodeCount > MAXIMUM_XML_NODE_COUNT || current.depth > MAXIMUM_XML_TREE_DEPTH) {
      return true;
    }

    if (isXmlElementNode(current.node)) {
      for (let index = 0; index < current.node.attributes.length; index += 1) {
        const attribute = current.node.attributes.item(index);
        if (attribute === null) {
          continue;
        }
        const attributeValue = attribute.nodeValue;
        if (typeof attributeValue === "string" && containsInvalidXmlCharacter(attributeValue)) {
          return true;
        }
        if (
          attribute.namespaceURI === XML_NAMESPACE_DECLARATION_NAMESPACE ||
          attribute.nodeName === "xmlns" ||
          attribute.prefix === "xmlns"
        ) {
          namespaceDeclarationCount += 1;
          if (namespaceDeclarationCount > MAXIMUM_XML_NAMESPACE_DECLARATION_COUNT) {
            return true;
          }
        }
      }
    }

    for (let child = current.node.lastChild; child !== null; child = child.previousSibling) {
      nodes.push({ depth: current.depth + 1, node: child });
    }
  }

  return false;
};

const isSignatureReferenceTransform = (transform: Element): boolean => {
  const transformsElement = transform.parentElement;
  const referenceElement = transformsElement?.parentElement;
  const signedInfoElement = referenceElement?.parentElement;
  const signatureElement = signedInfoElement?.parentElement;
  return (
    transformsElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    transformsElement.localName === "Transforms" &&
    referenceElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    referenceElement.localName === "Reference" &&
    signedInfoElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    signedInfoElement.localName === "SignedInfo" &&
    signatureElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    signatureElement.localName === "Signature"
  );
};

const isSignedInfoCanonicalizationMethod = (method: Element): boolean => {
  const signedInfoElement = method.parentElement;
  const signatureElement = signedInfoElement?.parentElement;
  return (
    method.namespaceURI === XMLDSIG_NAMESPACE &&
    method.localName === "CanonicalizationMethod" &&
    signedInfoElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    signedInfoElement.localName === "SignedInfo" &&
    signatureElement?.namespaceURI === XMLDSIG_NAMESPACE &&
    signatureElement.localName === "Signature"
  );
};

const isExclusiveCanonicalizationAlgorithm = (algorithm: string | null): boolean =>
  algorithm === XML_EXCLUSIVE_C14N_TRANSFORM ||
  algorithm === XML_EXCLUSIVE_C14N_WITH_COMMENTS_TRANSFORM;

const exceedsInclusiveNamespacePrefixListLimit = (prefixList: string): boolean => {
  if (prefixList.length > MAXIMUM_INCLUSIVE_NAMESPACE_PREFIX_LIST_LENGTH) {
    return true;
  }

  let tokenCount = 0;
  let insideToken = false;
  for (let index = 0; index < prefixList.length; index += 1) {
    const character = prefixList[index];
    if (character === " " || character === "\t" || character === "\n" || character === "\r") {
      insideToken = false;
      continue;
    }
    if (!insideToken) {
      tokenCount += 1;
      if (tokenCount > MAXIMUM_INCLUSIVE_NAMESPACE_PREFIX_COUNT) {
        return true;
      }
      insideToken = true;
    }
  }

  return false;
};

const containsExcessiveInclusiveNamespacePrefixList = (root: Node): boolean => {
  const nodes: Array<Node> = [root];

  while (nodes.length > 0) {
    const node = nodes.pop();
    if (node === undefined) {
      continue;
    }
    if (isXmlElementNode(node) && node.localName === "InclusiveNamespaces") {
      const parameterParent = node.parentElement;
      const prefixList = node.getAttribute("PrefixList");
      if (
        parameterParent !== null &&
        prefixList !== null &&
        exceedsInclusiveNamespacePrefixListLimit(prefixList) &&
        isExclusiveCanonicalizationAlgorithm(parameterParent.getAttribute("Algorithm")) &&
        (isSignatureReferenceTransform(parameterParent) ||
          isSignedInfoCanonicalizationMethod(parameterParent))
      ) {
        return true;
      }
    }

    for (let child = node.lastChild; child !== null; child = child.previousSibling) {
      nodes.push(child);
    }
  }

  return false;
};

const containsXPathTransform = (document: Document): boolean => {
  const transforms = document.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Transform");
  for (let index = 0; index < transforms.length; index += 1) {
    const transform = transforms.item(index);
    if (
      transform !== null &&
      transform.getAttribute("Algorithm") === XMLDSIG_XPATH_TRANSFORM &&
      isSignatureReferenceTransform(transform)
    ) {
      return true;
    }
  }

  return false;
};

const validateSignatureTransforms = (document: Document): Effect.Effect<void, XmlError> => {
  if (containsXPathTransform(document)) {
    return Effect.fail(
      new XmlError({
        code: XmlErrorCodeValue.unsupportedAlgorithm,
        retryable: false,
        reason: "XPath XMLDSig transforms are not supported.",
        operation: XmlOperationValue.verify,
      }),
    );
  }
  if (containsExcessiveInclusiveNamespacePrefixList(document)) {
    return Effect.fail(
      new XmlError({
        code: XmlErrorCodeValue.verifyFailed,
        retryable: false,
        reason: "XML canonicalization parameters exceed runtime limits.",
        operation: XmlOperationValue.verify,
      }),
    );
  }

  return Effect.void;
};

const validateSigningDocument = (
  document: Document,
): Effect.Effect<XmlSignatureStructure, XmlError> =>
  hasInvalidXmlDocumentChildren(document)
    ? Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.signFailed,
          retryable: false,
          reason: "XML document framing is not supported for signing.",
          operation: XmlOperationValue.sign,
        }),
      )
    : validateSignatureTransforms(document).pipe(
        Effect.mapError(
          (error) =>
            new XmlError({
              code: error.code,
              retryable: false,
              operation: XmlOperationValue.sign,
            }),
        ),
        Effect.map(() => inspectSignatureStructure(document)),
        Effect.flatMap((signatureStructure) =>
          signatureStructure.valid
            ? Effect.succeed(signatureStructure)
            : Effect.fail(
                new XmlError({
                  code: XmlErrorCodeValue.signFailed,
                  retryable: false,
                  reason: "XML signature structure exceeds verification limits.",
                  operation: XmlOperationValue.sign,
                }),
              ),
        ),
      );

const parseXml = (xml: string): Effect.Effect<Document, XmlError> =>
  Effect.suspend(() => {
    if (
      xml.length > MAXIMUM_XML_CHARACTER_COUNT ||
      containsInvalidXmlCharacter(xml) ||
      containsInvalidNumericCharacterReference(xml) ||
      hasInvalidXmlDocumentFraming(xml) ||
      exceedsXmlLexicalLimits(xml)
    ) {
      return Effect.fail(
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
        }),
      );
    }

    const xmlForParser = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;

    let hasParserDiagnostic = false;
    return Effect.try({
      try: () =>
        new DOMParser({
          onError: () => {
            hasParserDiagnostic = true;
          },
        }).parseFromString(xmlForParser, "application/xml"),
      catch: () =>
        new XmlError({
          code: XmlErrorCodeValue.invalidXml,
          retryable: false,
          operation: XmlOperationValue.parse,
        }),
    }).pipe(
      Effect.flatMap((document) =>
        hasParserDiagnostic ||
        document.doctype !== null ||
        document.documentElement === null ||
        hasInvalidXmlDocumentChildren(document) ||
        exceedsXmlStructuralLimits(document)
          ? Effect.fail(
              new XmlError({
                code: XmlErrorCodeValue.invalidXml,
                retryable: false,
                operation: XmlOperationValue.parse,
              }),
            )
          : Effect.succeed(document),
      ),
    );
  });

const importSpkiVerificationKey = (
  publicKeyDer: Uint8Array,
  algorithm: RsaHashedImportParams,
): Effect.Effect<CryptoKey, XmlError> =>
  Effect.tryPromise({
    try: () => {
      const keyBytes = new ArrayBuffer(publicKeyDer.byteLength);
      new Uint8Array(keyBytes).set(publicKeyDer);
      return crypto.subtle.importKey("spki", keyBytes, algorithm, true, ["verify"]);
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

const exportCertificateVerificationKey = (
  certificateDer: Uint8Array,
  algorithm: RsaHashedImportParams,
): Effect.Effect<CryptoKey, XmlError> =>
  Effect.tryPromise({
    try: () => {
      const certificateBytes = new ArrayBuffer(certificateDer.byteLength);
      new Uint8Array(certificateBytes).set(certificateDer);
      return new X509Certificate(certificateBytes).publicKey.export(algorithm, ["verify"]);
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

export const xmlRuntimeLayer: Layer.Layer<XmlRuntime, XmlError> = Layer.effect(
  XmlRuntime,
  Effect.gen(function* () {
    yield* configureXmlRuntime;
    const verificationKeys = yield* Cache.make({
      capacity: 32,
      timeToLive: "Infinity",
      lookup: (key: XmlVerificationKeyCacheKey) =>
        base64ToBytes(key.derBase64).pipe(
          Effect.orDie,
          Effect.flatMap((der) =>
            key.source === "spki"
              ? importSpkiVerificationKey(der, verificationAlgorithm(key))
              : exportCertificateVerificationKey(der, verificationAlgorithm(key)),
          ),
        ),
    });

    return {
      parse: parseXml,
      signedXml: () => Effect.succeed(XmlRuntimeSignedXml),
      validateSignatureTransforms,
      inspectSignatureStructure,
      validateSigningDocument,
      importVerificationKey: (publicKeyDer, algorithm) =>
        Cache.get(verificationKeys, verificationKeyCacheKey("spki", publicKeyDer, algorithm)),
      exportCertificateVerificationKey: (certificateDer, algorithm) =>
        Cache.get(
          verificationKeys,
          verificationKeyCacheKey("certificate", certificateDer, algorithm),
        ),
    };
  }),
);
