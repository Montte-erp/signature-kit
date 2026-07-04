# Changelog

## 0.1.0

- Initial release extracted from the retired `@signature-kit/core` package.
- Ships signature-runtime schemas, certificate contract schemas, `SignerAdapter`,
  `Signatures`, and `SignatureKitError`.
- Adds `signature-kit.CERTIFICATE_EXPIRED`,
  `signature-kit.CERTIFICATE_NOT_YET_VALID`, and
  `signature-kit.MISSING_BR_IDENTIFIER` error codes for A1 certificate profile
  failures that previously shared `signature-kit.INVALID_INPUT`.
- Exports English and pt-BR `signatureKitErrorMessages` catalogs for code-keyed
  display copy.
