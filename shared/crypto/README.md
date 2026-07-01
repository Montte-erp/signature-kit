# @signature-kit/crypto

Shared cryptographic primitives for PKCS#12, PEM, base64, hashing, and cipher operations.

## Install

```sh
bun add @signature-kit/crypto effect
```

## Exports

- `@signature-kit/crypto/base64`
- `@signature-kit/crypto/config`
- `@signature-kit/crypto/pem`
- `@signature-kit/crypto/pkcs12`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

This is a low-level support package: keep its surface narrow and prefer the higher-level SignatureKit packages unless you need the primitive directly.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
