# @signature-kit/certificates

Effect-safe PKCS#12 and X.509 parsing for certificate profiles, validity checks, Brazilian CPF/CNPJ extraction, and signer identity conversion.

## Install

```sh
bun add @signature-kit/certificates @signature-kit/signatures effect
```

`effect` is the runtime peer. PKCS#12 password values stay `Redacted` until parsing.

## Public surface

- `@signature-kit/certificates` — `X509SubjectSchema`, `X509IssuerSchema`, `X509InfoSchema`, `CertificateSourceSchema`, `parseCertificate`, `parseX509`, `extractBrazilianFields`, `toSignerIdentity`, `isCertificateValid`, and `daysUntilExpiry`.

`CertificateSource` accepts a PEM string, `ArrayBuffer`, or `ArrayBufferView`. `parseCertificate(source, password)` returns the normalized `Certificate` contract from `@signature-kit/signatures`; `parseX509(der)` returns X.509 metadata without requiring a private key.

## Example

```ts
import { daysUntilExpiry, parseCertificate, toSignerIdentity } from "@signature-kit/certificates";
import { Effect, Redacted } from "effect";

declare const pfx: Uint8Array;

const program = Effect.gen(function* () {
  const certificate = yield* parseCertificate(pfx, Redacted.make("secret"));
  const identity = toSignerIdentity(certificate);

  return {
    identity,
    expiresInDays: daysUntilExpiry(certificate),
  };
});
```

## Errors and i18n

PKCS#12, ASN.1, X.509, and schema failures are mapped to `SignatureKitError` from `@signature-kit/signatures` at the parse boundary. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/concepts/signer-boundary>.

## License

MIT. See `LICENSE`.
