# @signature-kit/pdf

PDF/PAdES document preparation, visible signature placement, stamping, signing, verification, and browser text-box extraction.

## Install

```sh
bun add @signature-kit/pdf effect
```

## Exports

- `@signature-kit/pdf/config`
- `@signature-kit/pdf/builder`
- `@signature-kit/pdf/builder-store`
- `@signature-kit/pdf/workflow`
- `@signature-kit/pdf/sign`
- `@signature-kit/pdf/stamp`
- `@signature-kit/pdf/liteparse-browser`
- `@signature-kit/pdf/verify`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
