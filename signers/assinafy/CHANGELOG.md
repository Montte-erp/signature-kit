## @signature-kit/assinafy@0.4.0

### Runtime updates and signature inspection

Update to stable Effect 4 and current compatible dependencies. Error classes use the native branded Schema.TaggedError constructor. Use TypeScript 7 for builds and checks with the official TypeScript 6 API compatibility alias. Upgrade direct ASN.1 dependencies to v4, interchange SDK values through DER, and encode timestamp requests with the native RFC 3161 schema. Packages do not require a consumer ASN.1 override.

Add per-signature PDF verification, certificate-validity inspection through the Effect clock, and cancellable polling for final request states in all five remote signers. Applications control polling deadlines and retry policy; a terminal request is not necessarily completed.

Update the documentation runtime, use the loading task for PDF.js cleanup, and fix dynamic Node routes by forwarding Request.duplex in the Hono adapter. Keep the app and Fumapress on a single Waku runtime.

Reject non-finite domain numbers, validate XML signature methods before WebCrypto verification, and preserve unexpected SDK failures as defects. Strengthen native Effect and accessibility lint checks.

Add branded PDF stamps with proportional PNG logos and handwriting, theme/title controls, and a PDF-rendered preview. Run browser PDF preparation and preview rendering through native Effect worker RPC with scoped termination and typed validation failures. Preserve caller buffers and signing dates across the worker boundary.

Fix structured batch stamp option conflicts, reject badges without usable drawing space, and prevent premeasured text from wrapping into adjacent rows. Restore signer interaction after React StrictMode mount replay and register localized Fumapress demo routes through the framework's native locale option. Add real worker, StrictMode, PDF text-stream, cropped/rotated page, cancellation, and invalid-image regressions.

# Changelog

## Unreleased

- Keep concrete credentials, provider, and provider-collection wiring private; consumers compose `AssinafySignatureRequest` through `providers(options)`.

## 0.3.0

- Assinafy now owns its signature-request props, attributes, state schema, schema
  names, and retained no-op diff instead of using core remote-signature contracts.
- Decode provider options through a cached credential Effect, so retained-resource
  `list` hooks and `read` calls without cached output do not touch credentials.
- Honor each signer `routingOrder` when creating Assinafy assignments, falling
  back to listed order when none is provided.
- Refuse signed-document downloads until the request is completed and a
  certificated artifact exists, returning typed `unsupportedOperation` instead
  of risking the unsigned PDF.
- Continue list pagination until an empty page, so provider page-size caps
  cannot truncate results.
- Add offline local-HTTP-server coverage for Assinafy provider behavior in the
  default test suite.

Breaking: request props now use `AssinafySignatureRequestProps` with
`contentBase64` documents, and `getAssinafySignatureRequest` /
`listAssinafySignatureRequests` return `AssinafySignatureRequestAttributes`
instead of core `RemoteSignature*` types.

## 0.2.0

- Rework lookup, listing, and deletion onto Assinafy's real document API
  (`GET /v1/documents/{id}`, `GET /v1/accounts/{accountId}/documents`, and
  `DELETE /v1/documents/{id}`), and return document ids from create so request
  ids are gettable/deletable.
- Remove the exported cancel function because the sandbox exposes no real
  document cancel endpoint.
- Paginate list results instead of returning only the first page.
- Omit provider credentials when following external (S3/CDN) download URLs.
- Make the multi-step create non-retryable after partial progress to avoid duplicate
  documents/signers on reconcile.

## 0.1.0

- Initial npm-ready release for `@signature-kit/assinafy`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships an Alchemy v2 remote-signature provider for Assinafy request creation, lookup, cancellation, deletion, and signed-document download.
