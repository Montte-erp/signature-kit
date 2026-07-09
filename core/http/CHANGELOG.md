# Changelog

## Unreleased

- Consolidate fetch, response-body consumption, timeout, and interruption into one abort-aware transport lifecycle while preserving the public service contract.

## 0.1.0

- Initial release extracted from the retired `@signature-kit/core` package.
- Ships `SignatureHttpClient`, HTTP request schemas, timeout handling, rate-limit retry metadata, and diagnostic URL redaction helpers.
