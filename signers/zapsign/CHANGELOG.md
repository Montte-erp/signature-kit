# Changelog

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
- Ships alchemy v2 remote-signature provider for ZapSign document creation, lookup, cancellation, deletion, and signed-document download.
