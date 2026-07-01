# @signature-kit/xml

XML-DSig document signing and verification APIs with an explicit XmlRuntime service for DOM and serializer capabilities.

## Install

```sh
bun add @signature-kit/xml effect
```

## Exports

- `@signature-kit/xml/config`
- `@signature-kit/xml/sign`
- `@signature-kit/xml/verify`
- `@signature-kit/xml/runtime`

## Runtime model

SignatureKit packages are Effect-native. Public APIs return typed `Effect.Effect` values; recoverable faults stay in the typed error channel; callers provide required services and layers explicitly at the application boundary.

## Version

Current npm release line: `0.1.0`.

## License

MIT. See `LICENSE`.
