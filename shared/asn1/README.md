# @signature-kit/asn1

Pure ASN.1 DER decode/encode primitives and typed accessors used by SignatureKit crypto, CMS, and certificate packages.

## Install

```sh
bun add @signature-kit/asn1 effect
```

`effect` is a direct runtime dependency. This is a low-level support package; prefer higher-level SignatureKit packages unless you need raw ASN.1.

## Public surface

- `@signature-kit/asn1` — `Asn1ClassSchema`, `Asn1PrimitiveSchema`, `Asn1NodeSchema`, `Asn1ConstructedSchema`, `Asn1ErrorCodeSchema`, `asn1ErrorMessages`, `Asn1Error`, `decode`, `encode`, `childrenOf`, `bytesOf`, `oidString`, and `integerBigInt`.

`decode(bytes)` reads the first complete DER TLV. `encode(node)` is total for nodes produced by `decode`. Typed accessors fail with `Asn1Error` when the requested shape does not match the node.

## Example

```ts
import { childrenOf, decode, encode } from "@signature-kit/asn1";
import { Effect } from "effect";

declare const der: Uint8Array;

const program = Effect.gen(function* () {
  const root = yield* decode(der);
  const children = yield* childrenOf(root);

  return {
    childCount: children.length,
    canonicalDer: encode(root),
  };
});
```

## Errors and i18n

ASN.1 failures use the `Asn1Error` code catalog and `asn1ErrorMessages`. Applications can render localized copy through `@signature-kit/i18n` by passing that catalog to `errorMessage`.

Docs: <https://signaturekit.dev/en-US/docs/concepts/document-formats>.

## License

MIT. See `LICENSE`.
