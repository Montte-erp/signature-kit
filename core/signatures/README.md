# @signature-kit/signatures

Effect-native signature runtime contracts, certificate schemas, typed SignatureKit errors, and the `Signatures` service.

## Install

```sh
bun add @signature-kit/signatures effect
```

## Export

- `@signature-kit/signatures`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
