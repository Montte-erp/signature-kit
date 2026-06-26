# core/

Workspace group for small publishable core packages.

- `core/core` → `@signature-kit/core` — runtime schemas, typed errors, and the `Signatures` service.
- `core/certificates` → `@signature-kit/certificates` — Effect-safe PKCS#12/X.509 parsing and identity helpers.

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  return yield* signatures.sign({
    content,
    algorithm: "rsa-sha256",
  });
}).pipe(
  Effect.provide(
    a1SignaturesLayer({
      pfx,
      password: Redacted.make("secret"),
    }),
  ),
);
```
