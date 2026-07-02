# Changelog

## 0.2.0

- Download signed documents via the envelope item id (previously passed the envelope id and
  404'd).
- Paginate list results.
- Drop the redundant 404 retry that repeated the identical failing request.

## 0.1.0

- Initial npm-ready release for `@signature-kit/documenso`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships alchemy v2 remote-signature provider for Documenso envelope creation, lookup, deletion, and signed-document download.
