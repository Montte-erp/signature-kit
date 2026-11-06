## @signature-kit/documenso@0.4.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.


Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## Unreleased

- Keep concrete credentials, provider, and provider-collection wiring private; consumers compose `DocumensoSignatureRequest` through `providers(options)`.

## 0.3.0

- Documenso now owns its envelope props, attributes, state schema, schema names,
  and retained no-op diff instead of using core remote-signature contracts.
- Decode provider options through a cached credential Effect, so retained-resource
  `list` hooks and `read` calls without cached output do not touch credentials.
- Treat failed envelope distribution as still `draft` with `not_distributed`
  provider status instead of reporting it as sent.
- Limit distribute rollback deletion to unambiguous pre-effect 4xx failures
  (except 408, 409, and 429); response-shape errors, 5xxs, and timeouts no
  longer delete possibly live envelopes.
- Accept missing recipient `signingUrl` values in create, get, and list responses.
- Add offline local-HTTP-server coverage for Documenso provider behavior in the
  default test suite.

Breaking: request props now use `DocumensoEnvelopeProps` with `contentBase64`
documents, and `getDocumensoSignatureRequest` / `listDocumensoSignatureRequests`
return `DocumensoEnvelope` instead of core `RemoteSignature*` types.

## 0.2.0

- Download signed documents via the envelope item id (previously passed the envelope id and
  404'd).
- Paginate list results.
- Drop the redundant 404 retry that repeated the identical failing request.

## 0.1.0

- Initial npm-ready release for `@signature-kit/documenso`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships an Alchemy v2 remote-signature provider for Documenso envelope creation, lookup, deletion, and signed-document download.
