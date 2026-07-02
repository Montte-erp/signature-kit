# Changelog

## 0.2.0

- Paginate list results instead of returning only the first page.
- Omit provider credentials when following external (S3/CDN) download URLs.
- Make the multi-step create non-retryable after partial progress to avoid duplicate
  documents/signers on reconcile.

## 0.1.0

- Initial npm-ready release for `@signature-kit/assinafy`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships alchemy v2 remote-signature provider for Assinafy request creation, lookup, cancellation, deletion, and signed-document download.
