# @signature-kit/asn1

Pure ASN.1 DER decoding and encoding primitives used by SignatureKit crypto, CMS, and certificate packages.

## Install

```sh
bun add @signature-kit/asn1 effect
```

## Exports

- `@signature-kit/asn1`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

This is a low-level support package: keep its surface narrow and prefer the higher-level SignatureKit packages unless you need the primitive directly.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
