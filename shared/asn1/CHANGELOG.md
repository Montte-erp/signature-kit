# Changelog

## 0.2.0

- Fix OID decoding of a multi-byte first subidentifier (arcs ≥ 80, e.g. `2.999`) by
  parsing the leading component as a base-128 VLQ.
- Reject trailing bytes after the top-level TLV instead of silently ignoring them.

## 0.1.0

- Initial npm-ready release for `@signature-kit/asn1`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships pure ASN.1 DER decoding and encoding primitives used by SignatureKit crypto, CMS, and certificate packages.
