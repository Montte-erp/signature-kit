# core/

Publishable core packages. They define shared contracts and services only; they do not import signer, format, or validator packages.

## Packages

- [`core/signatures`](signatures/README.md) → `@signature-kit/signatures` — signature contracts, the `Signatures` service, and `SignatureKitError`.
- [`core/http`](http/README.md) → `@signature-kit/http` — typed HTTP transport for remote providers and validators.
- [`core/certificates`](certificates/README.md) → `@signature-kit/certificates` — PKCS#12 and X.509 parsing over the core certificate contract.
- [`core/i18n`](i18n/README.md) → `@signature-kit/i18n` — localized code-keyed display messages.

All four packages export only their root specifier. Import package APIs from the package name, not hidden source files.

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

Docs: <https://signaturekit.dev/en-US/docs/concepts/signer-boundary>.
