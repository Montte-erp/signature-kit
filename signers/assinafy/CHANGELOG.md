# Changelog

## 0.3.0

- Assinafy now owns its signature-request props, attributes, state schema, schema
  names, and retained no-op diff instead of using core remote-signature contracts.
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
- Ships alchemy v2 remote-signature provider for Assinafy request creation, lookup, cancellation, deletion, and signed-document download.
