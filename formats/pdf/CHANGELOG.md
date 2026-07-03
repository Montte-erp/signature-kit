# Changelog

## 0.2.1

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

Behavior change: PDFs that previously verified despite unsigned appended bytes
or a broken older signature now fail verification.

## 0.2.0

- Embed the ICP-Brasil certificate chain in the detached CMS.
- Surface `chainValid` and `revocationStatus` from CMS verification; `chainValid` is now
  `false` unless `trustedRoots` are supplied.

## 0.1.0

- Initial npm-ready release for `@signature-kit/pdf`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships pDF/PAdES document preparation, visible signature placement, stamping, signing, verification, and browser text-box extraction.
