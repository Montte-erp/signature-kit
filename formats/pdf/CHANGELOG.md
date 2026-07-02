# Changelog

## 0.2.0

- Embed the ICP-Brasil certificate chain in the detached CMS.
- Surface `chainValid` and `revocationStatus` from CMS verification; `chainValid` is now
  `false` unless `trustedRoots` are supplied.

## 0.1.0

- Initial npm-ready release for `@signature-kit/pdf`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships pDF/PAdES document preparation, visible signature placement, stamping, signing, verification, and browser text-box extraction.
