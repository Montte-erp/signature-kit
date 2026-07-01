# @signature-kit/cms

CMS/PKCS#7 signing and verification helpers, including ICP-Brasil policy support and timestamp request contracts.

## Install

```sh
bun add @signature-kit/cms effect
```

## Exports

- `@signature-kit/cms/config`
- `@signature-kit/cms/icp-brasil`
- `@signature-kit/cms/sign`
- `@signature-kit/cms/verify`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

This is a low-level support package: keep its surface narrow and prefer the higher-level SignatureKit packages unless you need the primitive directly.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
