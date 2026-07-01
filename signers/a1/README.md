# @signature-kit/a1

Local A1 / PKCS#12 signer adapter that exposes signing power through the core SignerAdapter contract.

## Install

```sh
bun add @signature-kit/a1 effect
```

## Exports

- `@signature-kit/a1/config`
- `@signature-kit/a1/signer`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
