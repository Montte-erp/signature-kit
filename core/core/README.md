# @signature-kit/core

Effect-native signing contracts, typed SignatureKit errors, the Signatures service, and the shared HTTP client seam.

## Install

```sh
bun add @signature-kit/core effect
```

## Exports

- `@signature-kit/core/signatures`
- `@signature-kit/core/config`
- `@signature-kit/core/http`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
