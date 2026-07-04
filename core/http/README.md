# @signature-kit/http

Effect-native HTTP client seam for remote signature providers, with typed SignatureKit errors, timeout handling, response decoding, and redacted diagnostic URL support.

## Install

```sh
bun add @signature-kit/http @signature-kit/signatures effect
```

## Export

- `@signature-kit/http`

## Runtime model

Callers provide `signatureHttpClientLive` at the application boundary when a remote signer or validator needs transport. Provider packages depend on the service contract but do not hide the live transport in provider layers.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
