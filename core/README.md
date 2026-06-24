# core/

Workspace group for small publishable core packages.

- `core/core` → `@signature-kit/core` — runtime schemas, typed errors, `Signatures`, and `createSignatureKit`.
- `core/certificates` → `@signature-kit/certificates` — Effect-safe PKCS#12/X.509 parsing and identity helpers.

```ts
import { createSignatureKit } from "@signature-kit/core/runtime";
import { loadA1SignerAdapter } from "@signature-kit/a1/signer";
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
