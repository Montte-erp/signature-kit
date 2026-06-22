# signers/

Workspace group for local signer backends: packages that provide concrete
`SignerAdapter` signing power to the core runtime.

- `signers/a1` → `@signature-kit/a1` — A1 / PKCS#12 local signing power.

Remote provider integrations live under `integrations/*` so provider routing does
not turn `signers/` into a monolithic package bucket.

```ts
import { loadA1SignerAdapter } from "@signature-kit/a1";
import { Redacted } from "effect";

const signer =
  yield *
  loadA1SignerAdapter({
    pfx,
    password: Redacted.make("secret"),
  });
```
