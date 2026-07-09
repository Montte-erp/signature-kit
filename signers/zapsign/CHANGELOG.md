# Changelog

## Unreleased

- Keep concrete credentials, provider, and provider-collection wiring private; consumers compose `ZapSignSignatureRequest` through `providers(options)`.

## 0.3.0

- ZapSign now owns its single-PDF document props, attributes, state schema, schema
  names, and retained no-op diff instead of using core remote-signature contracts.
- Decode provider options through a cached credential Effect, so retained-resource
  `list` hooks and `read` calls without cached output do not touch credentials.
- Keep `detailsUrl` pointed at the ZapSign request-details endpoint instead of
  the raw unsigned PDF.
- Expose `downloadUrl` only from ZapSign's `signed_file` value, so callers no
  longer receive an unsigned PDF URL as the signed artifact.
- Add offline local-HTTP-server coverage for ZapSign provider behavior in the
  default test suite.

Breaking: request props now use `ZapSignDocumentProps` with a single
`application/pdf` document tuple and `contentBase64`, and
`getZapSignSignatureRequest` / `listZapSignSignatureRequests` return
`ZapSignDocument` instead of core `RemoteSignature*` types.

## 0.2.0

- Map signer refusal (`refused`/`rejected`) to `declined` instead of `cancelled`.
- Fix relative pagination-URL handling that doubled the `/api/v1` prefix.
- Total status mapping over exact literals instead of substring matching.
- Make the signer `token` optional in list responses (the real `/docs/` list omits it),
  fixing whole-page decode failures.
- Pin the paginated `next` URL onto the configured base origin so the `http://` link the API
  returns no longer drops the `Authorization` header on the redirect to `https://`.

## 0.1.0

- Initial npm-ready release for `@signature-kit/zapsign`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships an Alchemy v2 remote-signature provider for ZapSign document creation, lookup, cancellation, deletion, and signed-document download.
