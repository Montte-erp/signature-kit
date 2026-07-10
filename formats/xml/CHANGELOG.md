# Changelog

## 0.2.1

- Export English and pt-BR `xmlErrorMessages` catalogs for code-keyed display
  copy.

- Move `SignedXml` construction into `XmlRuntime` and cache verification-key
  imports, avoiding repeated XML-DSig module loads and repeated key imports
  during signing and verification.
- Import XML signing certificates and signing keys concurrently.

- Security: `requiredReference` binds a signed URI to a unique namespace-aware
  direct-child path from the document element to its target, closing semantic
  target relocation and unsigned manifest-reference bypasses.
- Security: reject empty signing reference IDs, tolerate repeated same-element
  ID aliases, and surface backend verification rejections as typed `XmlError`s.
- Security: require exactly one of `publicKeyDer` or `trustedCertificateDer`;
  no precedence rule can override a pinned trust source.
- Security: bound verification to 4 signatures, 4 direct `SignedInfo` references
  per signature, 8 total references, 3 direct transforms per reference, and 8
  total transforms; reject repeated canonicalization transforms; collect bounded
  metadata before crypto and stop cryptographic verification at the first invalid
  signature.
- Security: enforce XML 1.0 lexical validity, root-only framing, and parser
  budgets for input size, nodes, attributes, namespaces, depth, and InclusiveNamespaces PrefixList.
- Security: revalidate serialized signing output before returning it, so runtime
  caps cannot yield XML that this verifier rejects.

Breaking: `requireReferenceUri` has been replaced by `requiredReference`.

## 0.2.0

- Security: `verifyXml` no longer trusts key material embedded in the document. Callers must
  supply `publicKeyDer` or a trusted `trustedCertificateDer`; self-signed embedded certs are
  no longer accepted as valid signers.
- Security: verify every signature in the document and reject duplicate-`Id` or relocated-
  target inputs (signature-wrapping / XSW).
- Derive the digest hash from the signature's `SignatureMethod` instead of a caller default.
- Add an inclusive C14N option for ABRASF/SEFAZ (NF-e/NFS-e) documents.

Breaking: `verifyXml` requires explicit trust material and rejects previously-accepted
self-verified documents.

## 0.1.0

- Initial npm-ready release for `@signature-kit/xml`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships XML-DSig document signing and verification APIs with an explicit XmlRuntime service for DOM and serializer capabilities.
