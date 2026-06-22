# integrations/

Workspace group for optional provider integrations outside local signer backends and
document formats.

- `integrations/signature-gateway` → `@signature-kit/signature-gateway` — provider-neutral signature request seam.
- `integrations/docusign` → `@signature-kit/docusign` — DocuSign adapter.
- `integrations/dropbox-sign` → `@signature-kit/dropbox-sign` — Dropbox Sign adapter.
- `integrations/adobe-sign` → `@signature-kit/adobe-sign` — Adobe Acrobat Sign adapter.
- `integrations/clicksign` → `@signature-kit/clicksign` — Clicksign adapter.

Provider packages export small factory functions, so one gateway can route several
providers without a monolithic provider package.
