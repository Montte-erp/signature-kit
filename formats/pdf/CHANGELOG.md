# Changelog

## 0.2.1

- Security: `verifyPdf` rejects ByteRange signatures that do not start at byte 0
  or whose newest signature does not cover the file end, blocking
  signature-exclusion forgeries.
- Security: `verifyPdf` verifies every PDF signature in the file, not only the
  newest incremental revision.
- Preserve existing signatures when signing an already-signed PDF by adding the
  new signature as an incremental update.
- Extract the CMS `/Contents` value by DER sequence length before falling back to
  zero trimming, so valid signatures ending in `00` bytes verify correctly.

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
