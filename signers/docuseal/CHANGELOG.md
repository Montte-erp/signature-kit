# Changelog

## 0.3.0

- DocuSeal now owns its submission props, attributes, state schema, schema names,
  and retained no-op diff instead of using core remote-signature contracts.
- Decode provider options through a cached credential Effect, so retained-resource
  `list` hooks and `read` calls without cached output do not touch credentials.
- Refuse signed-document downloads before a submission is completed, returning a
  typed `unsupportedOperation` instead of silently returning the unsigned source
  document.
- Advertise `downloadUrl` only for completed submissions, because draft
  submission document URLs can point at unsigned bytes.
- Add offline local-HTTP-server coverage for DocuSeal provider behavior in the
  default test suite.

Breaking: request props now use `DocuSealSubmissionProps` with `contentBase64`
documents, and `getDocuSealSignatureRequest` / `listDocuSealSignatureRequests`
return `DocuSealSubmissionAttributes` instead of core `RemoteSignature*` types.

## 0.2.0

- Deduplicate submitter roles so recipients sharing a role are accepted by DocuSeal.
- Paginate list results.
- Total status mapping over exact literals instead of substring matching.
- Accept JSON `null` for optional URL fields (`combined_document_url`, `embed_src`, etc.) that
  the real API returns for unsigned submissions, instead of failing response decode.

## 0.1.0

- Initial npm-ready release for `@signature-kit/docuseal`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships an Alchemy v2 remote-signature provider for DocuSeal submission creation, lookup, deletion, and signed-document download.
