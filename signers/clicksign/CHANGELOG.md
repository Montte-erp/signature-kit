## @signature-kit/clicksign@0.4.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.

Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## Unreleased

- Keep concrete credentials, provider, and provider-collection wiring private; consumers compose `ClicksignSignatureRequest` through `providers(options)`.

## 0.3.0

- Clicksign now owns its document/signature-request props, attributes, state
  schema, schema names, and retained no-op diff instead of using core
  remote-signature contracts.
- Decode provider options through a cached credential Effect, so retained-resource
  `list` hooks and `read` calls without cached output do not touch credentials.
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
