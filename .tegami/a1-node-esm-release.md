---
packages:
  "@signature-kit/a1": minor
---

## Publish A1 with Node-resolvable imports

Release the fully specified relative imports already in source, so `@signature-kit/a1/signer` loads under native Node ESM instead of failing with `ERR_MODULE_NOT_FOUND`.

This release also removes the unused `A1Signer` service and `a1SignerLayer`; use `a1SignaturesLayer` or `loadA1SignerAdapter`.
