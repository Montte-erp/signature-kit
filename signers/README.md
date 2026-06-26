# signers/

Workspace group for signer backends and remote-signature adapters.

- `signers/a1` → `@signature-kit/a1` — A1 / PKCS#12 local signing power.
- `signers/docusign` → `@signature-kit/docusign` — DocuSign remote signing workflow.
- `signers/clicksign` → `@signature-kit/clicksign` — Clicksign remote signing workflow.
- `signers/assinafy` → `@signature-kit/assinafy` — Assinafy remote signing workflow.
- `signers/zapsign` → `@signature-kit/zapsign` — ZapSign remote signing workflow.
- `signers/docuseal` → `@signature-kit/docuseal` — DocuSeal remote signing workflow.
- `signers/adobe-sign` → `@signature-kit/adobe-sign` — Adobe Acrobat Sign remote signing workflow.
- `signers/dropbox-sign` → `@signature-kit/dropbox-sign` — Dropbox Sign remote signing workflow.
- `signers/documenso` → `@signature-kit/documenso` — Documenso remote signing workflow.

There is no `integrations/*` layer and no provider-neutral gateway package.

```ts
import { loadA1SignerAdapter } from "@signature-kit/a1/signer";
import { Redacted } from "effect";

const signer =
  yield *
  loadA1SignerAdapter({
    pfx,
    password: Redacted.make("secret"),
  });
```
