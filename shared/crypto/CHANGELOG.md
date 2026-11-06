## @signature-kit/crypto@0.2.2

### Simplify Effect programs

Use native void effects and value-discarding combinators while preserving public success, error, and dependency contracts. The workspace now enforces Effect correctness and selected simplification rules through the official Effect TypeScript-Go integration with Oxlint.

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.

Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## 0.2.1

- Export English and pt-BR `cryptoErrorMessages` catalogs for code-keyed display
  copy.

- Security: bound PKCS#12 MAC, PBKDF2, and legacy PBE iteration counts at 10M so
  attacker-controlled `.pfx` files cannot pin the event loop before the password
  is checked.
- Extend hardening coverage across PBES2/PBKDF2 encrypted-data, legacy PBE, and
  the exact 10M boundary; runtime behavior is unchanged.

## 0.2.0

- Fix SHA-512/SHA-384 message-length encoding for inputs ≥ 512 MiB (also corrects
  HMAC-SHA384/512 and PKCS#12 MAC verification over such inputs).
- Zero-pad HMAC keys longer than the block size instead of relying on out-of-bounds reads.

## 0.1.0

- Initial npm-ready release for `@signature-kit/crypto`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships shared cryptographic primitives for PKCS#12, PEM, base64, hashing, and cipher operations.
