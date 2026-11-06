## @signature-kit/pdf@0.4.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.


Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## 0.3.0

- Export English and pt-BR `pdfErrorMessages` catalogs for code-keyed display
  copy.
- Add vector QR-code support to visible signature stamps, enabling ITI validator
  links without raster images in Node and browser PDF flows.
- Add a structured digital-signature badge stamp layout with QR, rounded
  Brazilian-government-style framing, legal footer text, and URI link
  annotations.
- Add package-owned PDF DX helpers: text-anchor placement, `prepareAndSignPdf`,
  vector initials rubrics with `deriveSignerInitials`, `mergePdfs`, and a
  bottom-right default signature rectangle helper.
- Use the pinned ICP-Brasil AD-RB policy metadata by default for
  `policy: "pades-icp-brasil"`, and reserve 32768 `/Contents` bytes for that
  policy unless callers set `signatureLength` explicitly.
- Security: `verifyPdf` rejects ByteRange signatures that do not start at byte 0
  or whose newest signature does not cover the file end, blocking
  signature-exclusion forgeries.
- Security: `verifyPdf` verifies every PDF signature in the file, not only the
  newest incremental revision, and reports the worst `revocationStatus` across
  all signatures.
- Treat `valid` as chain-valid when `trustedRoots` are supplied; a trusted root
  set now makes `valid` require successful chain verification.
- Detect `/ByteRange` when any PDF whitespace appears between the name and `[`,
  allowing third-party PDFs with non-space formatting to verify and preserving
  incremental re-signing for them.
- Preserve existing signatures when signing an already-signed PDF by adding the
  new signature as an incremental update.
- Enforce the unsigned `/Contents` hole by requiring `<`/`>` delimiters, failing
  closed on malformed hex, and allowing only zero padding after the DER
  signature.
- Verify multi-signature PDFs one signed range at a time instead of
  materializing every signed-range copy simultaneously.
- PAdES CMS output no longer emits the prohibited CMS `signingTime` signed
  attribute (OID 1.2.840.113549.1.9.5); ITI Validar
  (PA_PAdES_AD_RB_v1_1) now approves generated signatures. Signing time remains
  in the PDF dictionary `/M` entry.

Breaking: `policyTimeoutMillis` was removed from public PDF signing request
schemas.

Behavior change: PDFs that previously verified despite unsigned appended bytes
or a broken older signature now fail verification.

## 0.2.0

- Embed the ICP-Brasil certificate chain in the detached CMS.
- Surface `chainValid` and `revocationStatus` from CMS verification; `chainValid` is now
  `false` unless `trustedRoots` are supplied.

## 0.1.0

- Initial npm-ready release for `@signature-kit/pdf`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships PDF/PAdES document preparation, visible signature placement, stamping, signing, verification, and browser text-box extraction.
