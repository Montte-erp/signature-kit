# Changelog

## 0.2.0

- Map signer refusal (`refused`/`rejected`) to `declined` instead of `cancelled`.
- Fix relative pagination-URL handling that doubled the `/api/v1` prefix.
- Total status mapping over exact literals instead of substring matching.

## 0.1.0

- Initial npm-ready release for `@signature-kit/zapsign`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships alchemy v2 remote-signature provider for ZapSign document creation, lookup, cancellation, deletion, and signed-document download.
