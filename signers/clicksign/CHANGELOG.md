# Changelog

## 0.3.0

- Clicksign now owns its document/signature-request props, attributes, state
  schema, schema names, and retained no-op diff instead of using core
  remote-signature contracts.
- Cancel Clicksign documents with `PATCH /api/v1/documents/{key}/cancel`, matching
  the provider API that rejected the previous `POST`.
- Stop fabricating signed-document download URLs; absent signed-file URLs now stay
  absent and download attempts fail as typed `unsupportedOperation` errors.
- Enable sequential signing only when at least one signer has `routingOrder`, so
  unordered multi-signer requests remain parallel.
- Redact `access_token` from token-bearing signed-document diagnostic URLs, so
  typed error reasons never leak provider download secrets.
- Limit create rollback deletion to unambiguous pre-effect 4xx failures (except
  408, 409, and 429); response-shape errors, 5xxs, and timeouts no longer delete
  possibly live documents.
- Add offline local-HTTP-server coverage for Clicksign provider behavior in the
  default test suite.

Breaking: request props now use `ClicksignSignatureRequestProps` with
`contentBase64` documents, and `getClicksignSignatureRequest` /
`listClicksignSignatureRequests` return `ClicksignSignatureRequestAttributes`
instead of core `RemoteSignature*` types.

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
- Ships an Alchemy v2 remote-signature provider for Clicksign document creation, lookup, cancellation, deletion, and signed-document download.
