# @signature-kit/crypto

Shared cryptographic primitives for base64, PEM, PKCS#12, hashing, and cipher operations.

## Install

```sh
bun add @signature-kit/crypto effect
```

`effect` is the runtime peer. This is a low-level support package; prefer higher-level SignatureKit packages unless you need the primitive directly.

## Public surface

- `@signature-kit/crypto/base64` — `bytesToBase64` and `base64ToBytes`.
- `@signature-kit/crypto/config` — `CryptoError`, `CryptoErrorCodeValue`, operation schemas, message catalogs, and `Pkcs12ResultSchema`.
- `@signature-kit/crypto/pem` — `pemToDer` and `derToPem`.
- `@signature-kit/crypto/pkcs12` — `parsePkcs12`.

## Example

```ts
import { bytesToBase64 } from "@signature-kit/crypto/base64";
import { pemToDer } from "@signature-kit/crypto/pem";
import { Effect } from "effect";

declare const certificatePem: string;

const program = Effect.gen(function* () {
  const der = yield* pemToDer(certificatePem);

  return {
    der,
    contentBase64: bytesToBase64(der),
  };
});
```

## Errors and i18n

Crypto failures use the `CryptoError` code catalog and `cryptoErrorMessages`. Applications can render localized copy through `@signature-kit/i18n` by passing that catalog to `errorMessage`.

Docs: <https://signaturekit.dev/en-US/docs/concepts/document-formats>.

## License

MIT. See `LICENSE`.
