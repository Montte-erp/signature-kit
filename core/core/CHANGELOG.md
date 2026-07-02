# Changelog

## 0.2.0

- HTTP client now honors Effect interruption and request timeouts by driving `fetch` and
  the response-body reads from the abort signal (previously requests could hang forever).
- Drain the response body on `requestVoid` success to release pooled connections.
- Classify `retryable` by HTTP method idempotency, except a 429 (rate limit) is always
  retryable since the request was rejected before taking effect.
- Surface `retryAfterEpochSeconds` on `SignatureKitError` from `x-ratelimit-reset`/`Retry-After`
  so callers can back off to the reset window.
- Report the real schema name on JSON parse failures.
- Validate abort-error shape through Schema instead of sniffing `.name`.

## 0.1.0

- Initial npm-ready release for `@signature-kit/core`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships effect-native signing contracts, typed SignatureKit errors, the Signatures service, and the shared HTTP client seam.
