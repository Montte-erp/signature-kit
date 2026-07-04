# @signature-kit/xml

XML-DSig document signing and verification through an explicit `XmlRuntime` service for DOM parsing, serializer capabilities, `SignedXml` construction, and cached verification-key import.

## Install

```sh
bun add @signature-kit/xml @signature-kit/signatures effect
```

Add a signer backend at the application boundary, for example:

```sh
bun add @signature-kit/a1
```

`effect` is the runtime peer. DOM/XML runtime state is provided through `xmlRuntimeLayer`.

## Public surface

- `@signature-kit/xml/config` — XML signing/verification schemas, algorithm/canonicalization contracts, error catalog, and message catalog.
- `@signature-kit/xml/runtime` — `XmlRuntime`, `XmlRuntimeService`, and `xmlRuntimeLayer`.
- `@signature-kit/xml/sign` — `signXml`.
- `@signature-kit/xml/verify` — `verifyXml`.

Verification requires an explicit key source: `publicKeyDer` or `trustedCertificateDer`. Self-signed embedded certificates are not accepted as valid signers by default. Verification rejects duplicate or relocated target references and can require a specific reference URI.

## Example

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signXml } from "@signature-kit/xml/sign";
import { verifyXml } from "@signature-kit/xml/verify";
import { xmlRuntimeLayer } from "@signature-kit/xml/runtime";
import { Effect, Redacted } from "effect";

declare const xml: string;
declare const pfx: Uint8Array;
declare const trustedCertificateDer: Uint8Array;

const program = Effect.gen(function* () {
  const signedXml = yield* signXml({
    xml,
    referenceId: "invoice-1",
    algorithm: "rsa-sha256",
  });

  const verification = yield* verifyXml({
    xml: signedXml,
    trustedCertificateDer,
    requireReferenceUri: "#invoice-1",
  });

  return { signedXml, verification };
}).pipe(
  Effect.provide(xmlRuntimeLayer),
  Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") })),
);
```

## Errors and i18n

XML failures use the `XmlError` code catalog and `xmlErrorMessages`; signer failures can also surface from signing. Applications can render localized copy through `@signature-kit/i18n` with the catalogs for every package they call.

Docs: <https://signaturekit.dev/en-US/docs/signing/xml>.

## License

MIT. See `LICENSE`.
