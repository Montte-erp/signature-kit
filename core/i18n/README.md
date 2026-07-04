# @signature-kit/i18n

Localized error-message resolution for SignatureKit tagged errors.

## Install

```sh
bun add @signature-kit/i18n effect
```

## Export

- `@signature-kit/i18n`

## Runtime model

Call `errorMessage(error, options)` at the application boundary with the package catalogs your code can receive. The resolver reads `_tag` and `code` structurally; consumers do not need `instanceof`, `.code` sniffing helpers, or reason-string matching.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
