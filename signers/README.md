# signers/

Signer backends and remote-signature providers. Local signers expose signing power through `Signatures`; remote SaaS providers expose retained Alchemy resources for provider-side request workflows.

## Packages

- [`signers/a1`](a1/README.md) → `@signature-kit/a1` — local A1 / PKCS#12 signing power.
- [`signers/assinafy`](assinafy/README.md) → `@signature-kit/assinafy` — Assinafy request creation, get/list/delete, and completed-document download; no public cancel API.
- [`signers/clicksign`](clicksign/README.md) → `@signature-kit/clicksign` — Clicksign request creation, get/list/cancel/delete, and signed-file download.
- [`signers/documenso`](documenso/README.md) → `@signature-kit/documenso` — Documenso envelope creation, get/list/cancel/delete, and completed-document download.
- [`signers/docuseal`](docuseal/README.md) → `@signature-kit/docuseal` — DocuSeal submission creation, get/list/delete, and completed-document download; no public cancel API.
- [`signers/zapsign`](zapsign/README.md) → `@signature-kit/zapsign` — ZapSign single-PDF document creation, get/list/cancel/delete, and signed-file download.

Remote resources are retained: their providers return an empty Alchemy `list`, set `nuke: { skip: true }`, and reconcile existing outputs as no-ops. Use each package's explicit get/list/cancel/delete/download helpers for targeted provider API operations.

Docs: <https://signaturekit.dev/en-US/docs/concepts/remote-signature-requests>.
