## @signature-kit/zapsign@0.4.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.


Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

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
