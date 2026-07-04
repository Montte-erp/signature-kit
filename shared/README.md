# shared/

Low-level support packages that are published because public packages depend on them. They are not the product surface; prefer `core/`, `formats/`, `signers/`, or `validators/` unless you need the primitive directly.

## Packages

- [`shared/asn1`](asn1/README.md) → `@signature-kit/asn1` — pure ASN.1 DER decode/encode and typed accessors.
- [`shared/crypto`](crypto/README.md) → `@signature-kit/crypto` — base64, PEM, PKCS#12, hashing, and cipher primitives.
- [`shared/cms`](cms/README.md) → `@signature-kit/cms` — CMS/PKCS#7 detached signatures, ICP-Brasil policy metadata, inspection, verification, and timestamping.

Docs: <https://signaturekit.dev/en-US/docs/concepts/document-formats>.
