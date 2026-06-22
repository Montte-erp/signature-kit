# core/

Workspace group for small publishable core packages.

- `core/contracts` → `@signature-kit/contracts` — shared schemas, typed errors, signer contracts.
- `core/x509` → `@signature-kit/x509` — X.509 parsing and certificate identity helpers.
- `core/core` → `@signature-kit/core` — the lean `Signatures` service plus `createSignatureKit` runtime facade.

```ts
import { createSignatureKit } from "@signature-kit/core";
import { loadA1SignerAdapter } from "@signature-kit/a1";
import { Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const signer = yield* loadA1SignerAdapter({
    pfx,
    password: Redacted.make("secret"),
  });
  const signatureKit = createSignatureKit({ signer });

  return yield* signatureKit.signatures.sign({
    content,
    algorithm: "rsa-sha256",
  });
});
```
