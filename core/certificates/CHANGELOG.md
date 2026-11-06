## @signature-kit/certificates@0.3.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.


Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## Unreleased

- Remove the redundant `X509SubjectSchema` and `X509IssuerSchema` aliases; `X509InfoSchema` uses the canonical certificate subject and issuer contracts directly.

## 0.2.1

- Parse X.509 metadata and the SHA-256 fingerprint concurrently when reading a
  certificate, and report certificate schema decode names without depending on
  the removed core schema-name catalog.

## 0.2.0

- Retain intermediate CA certificates (`intermediateCertificates`) so signatures can embed
  the full ICP-Brasil chain.
- Decode DirectoryString values by their ASN.1 tag (BMPString → UTF-16BE), fixing garbled
  subjects and CPF/CNPJ extraction on legacy certificates.
- Accept UTCTime without a seconds field; fail typed instead of producing an Invalid Date.
- Anchor CNPJ extraction to the real field rather than the first 14-digit run.

Breaking: `Certificate` gained a required `intermediateCertificates` field.

## 0.1.0

- Initial npm-ready release for `@signature-kit/certificates`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships PKCS#12 and X.509 certificate parsing APIs for certificate profiles, validity checks, and signer identity extraction.
