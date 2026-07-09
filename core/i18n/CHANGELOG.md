# Changelog

## Unreleased

- Keep `errorMessage` a pure lookup over typed `ErrorMessageOptions`; callers decode untrusted values explicitly with `ErrorMessageOptionsSchema`.

## 0.1.0

- Initial release for localized SignatureKit error-message resolution after the
  retirement of `@signature-kit/core`.
