# Changelog

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
- Ships xML-DSig document signing and verification APIs with an explicit XmlRuntime service for DOM and serializer capabilities.
