# @signature-kit/i18n

Localized display-message resolution for SignatureKit tagged errors.

## Install

```sh
bun add @signature-kit/i18n effect
```

`effect` is a direct runtime dependency because the option and catalog contracts are Schema-backed.

## Public surface

- `@signature-kit/i18n` — `LocalizedCatalogSchema`, `LocalizedMessageMap`, `ErrorMessageOptionsSchema`, `ErrorMessageFallbackCodeSchema`, `ErrorMessageLocaleSchema`, `errorMessageFallbackMessages`, and `errorMessage(error, options)`.

`errorMessage(error, options)` reads `_tag` and `code` structurally. Consumers do not need `instanceof`, `.code` helper wrappers, or reason-string matching.

Resolution order for a known code:

1. `overrides[locale][code]`
2. `catalogs[*][locale][code]`
3. `overrides[fallbackLocale][code]`
4. `catalogs[*][fallbackLocale][code]`
5. generic fallback messages for the requested locale, fallback locale, then `en-US`

The default fallback locale is `en-US`.

## Example

```ts
import { errorMessage } from "@signature-kit/i18n";
import { signatureKitErrorMessages, type SignatureKitError } from "@signature-kit/signatures";

declare const error: SignatureKitError;

const message = errorMessage(error, {
  locale: "pt-BR",
  fallbackLocale: "en-US",
  catalogs: [signatureKitErrorMessages],
  overrides: {
    "pt-BR": {
      "signature-kit.WRONG_PASSWORD": "Senha inválida para este certificado.",
    },
  },
});
```

## Errors and i18n

This package is the display layer. Package-specific message catalogs remain beside their `TaggedErrorClass` definitions: `signatureKitErrorMessages`, `pdfErrorMessages`, `xmlErrorMessages`, `cmsErrorMessages`, `cryptoErrorMessages`, and `asn1ErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/signing/errors>.

## License

MIT. See `LICENSE`.
