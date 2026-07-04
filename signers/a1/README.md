# @signature-kit/a1

Local A1 / PKCS#12 signer adapter that exposes signing power through the core `SignerAdapter` and `Signatures` service contracts.

## Install

```sh
bun add @signature-kit/a1 @signature-kit/signatures effect
```

`effect` is the runtime peer. PKCS#12 passwords stay `Redacted` until the explicit parse/import boundary.

## Public surface

- `@signature-kit/a1/config` — `A1SignerOptionsSchema`, remote-source schemas, and `A1CertificateProfileSchema`.
- `@signature-kit/a1/signer` — `createA1SignerAdapter`, `loadA1SignerAdapter`, `a1SignerLayer`, `a1SignaturesLayer`, `parseA1CertificateProfile`, `fetchA1Pkcs12`, `a1SignaturesLayerFromUrl`, and `parseA1CertificateProfileFromUrl`.

`a1SignaturesLayer(options)` is the usual application-boundary layer for local PDF/XML signing. URL helpers fetch a remote `.pfx`/`.p12` through `SignatureHttpClient`; presigned URLs are redacted in error messages through the diagnostic URL path.

## Example

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/signatures";
import { Effect, Redacted } from "effect";

declare const content: Uint8Array;
declare const pfx: Uint8Array;

const program = signatures
  .sign({
    content,
    algorithm: "rsa-sha256",
  })
  .pipe(Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") })));
```

## Errors and i18n

A1 parse, import, sign, and certificate-profile failures surface as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/a1-signing/browser-pdf-flow>.

## License

MIT. See `LICENSE`.
