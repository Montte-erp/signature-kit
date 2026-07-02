# Changelog

## 0.2.0

- Authenticate same-host signed-document downloads (previously the fallback URL was requested
  without an access token and always 401'd).
- Map the `closed` terminal status to completed.
- Paginate list results.
- Make the multi-step create non-retryable after partial progress.
- Total status mapping over exact literals instead of substring matching.

## 0.1.0

- Initial npm-ready release for `@signature-kit/clicksign`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships alchemy v2 remote-signature provider for Clicksign document creation, lookup, cancellation, deletion, and signed-document download.
