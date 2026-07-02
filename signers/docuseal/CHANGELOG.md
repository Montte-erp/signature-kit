# Changelog

## 0.2.0

- Deduplicate submitter roles so recipients sharing a role are accepted by DocuSeal.
- Paginate list results.
- Total status mapping over exact literals instead of substring matching.
- Accept JSON `null` for optional URL fields (`combined_document_url`, `embed_src`, etc.) that
  the real API returns for unsigned submissions, instead of failing response decode.

## 0.1.0

- Initial npm-ready release for `@signature-kit/docuseal`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships alchemy v2 remote-signature provider for DocuSeal submission creation, lookup, deletion, and signed-document download.
