# Changelog

## 0.3.0

- Documenso now owns its envelope props, attributes, state schema, schema names,
  and retained no-op diff instead of using core remote-signature contracts.
- Treat failed envelope distribution as still `draft` with `not_distributed`
  provider status instead of reporting it as sent.
- Avoid deleting a live envelope when distribution response-shape decoding fails;
  rollback deletion now runs only for failures where the request did not take
  remote effect.
- Accept missing recipient `signingUrl` values in create, get, and list responses.

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
- Ships alchemy v2 remote-signature provider for Documenso envelope creation, lookup, deletion, and signed-document download.
