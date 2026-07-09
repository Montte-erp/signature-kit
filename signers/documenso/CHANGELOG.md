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
