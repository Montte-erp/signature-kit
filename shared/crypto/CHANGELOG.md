# Changelog

## 0.2.0

- Fix SHA-512/SHA-384 message-length encoding for inputs ≥ 512 MiB (also corrects
  HMAC-SHA384/512 and PKCS#12 MAC verification over such inputs).
- Zero-pad HMAC keys longer than the block size instead of relying on out-of-bounds reads.

## 0.1.0

- Initial npm-ready release for `@signature-kit/crypto`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships shared cryptographic primitives for PKCS#12, PEM, base64, hashing, and cipher operations.
