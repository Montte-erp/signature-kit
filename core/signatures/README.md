# @signature-kit/signatures

Effect-native signature runtime contracts, certificate schemas, typed `SignatureKitError`s, and the `Signatures` service.

## Install

```sh
bun add @signature-kit/signatures effect
```

Add at least one signer backend at the application boundary, for example:

```sh
bun add @signature-kit/a1
```

`effect` is a direct runtime dependency. Public APIs return typed `Effect.Effect` values.

## Public surface

- `@signature-kit/signatures` — root export for signature algorithms, certificate/profile schemas, sign/verify input schemas, `SignerAdapter`, `Signatures`, `signatures`, `signaturesLayer`, `SignatureKitError`, `SignatureKitErrorCodeValue`, `signatureKitErrorCatalog`, and `signatureKitErrorMessages`.

The `SignatureKitErrorCodeSchema` catalog has 21 codes: 18 domain/runtime codes plus the transport trio `signature-kit.HTTP`, `signature-kit.RESPONSE_SHAPE`, and `signature-kit.UNSUPPORTED_OPERATION`. Ten invariant codes are non-overridable in `SignatureKitError.message`: empty file, wrong password, expired/not-yet-valid certificate, missing Brazilian identifier, missing certificate/private key, corrupted file, PEM extraction failure, and digest failure.

## Example

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/signatures";
import { Effect, Redacted } from "effect";

declare const content: Uint8Array;
declare const pfx: Uint8Array;

const signature = await Effect.runPromise(
  signatures
    .sign({
      content,
      algorithm: "rsa-sha256",
    })
    .pipe(Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") }))),
);
```

Providers and format packages should depend on this service contract, not on a concrete signer. Do not hide `Effect.provide` inside library internals; provide the signer layer where the program is run.

## Migration from `@signature-kit/core`

The retired `@signature-kit/core` package was split into focused packages:

| Old import                                                                                                                         | New import                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `SignatureKitError`, `SignatureKitErrorCodeValue`, `signatureKitErrorMessages`                                                     | `@signature-kit/signatures`   |
| `SignatureAlgorithmSchema`, `SignInputSchema`, `VerifyInputSchema`, `SignerAdapter`, `Signatures`, `signatures`, `signaturesLayer` | `@signature-kit/signatures`   |
| `signatureHttpClientLive`, `SignatureHttpClient`, `bearerAuthorization`, `normalizedBaseUrl`                                       | `@signature-kit/http`         |
| `parseCertificate`, `parseX509`, `toSignerIdentity`, `isCertificateValid`, `daysUntilExpiry`                                       | `@signature-kit/certificates` |
| `errorMessage`                                                                                                                     | `@signature-kit/i18n`         |
| `loadA1SignerAdapter`, `a1SignaturesLayer`                                                                                         | `@signature-kit/a1/signer`    |

## Errors and i18n

Construct `SignatureKitError` at the decision point with the stable code, operation, provider, HTTP status, schema name, and issue text that are actually known. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/signing/errors>.

## License

MIT. See `LICENSE`.
