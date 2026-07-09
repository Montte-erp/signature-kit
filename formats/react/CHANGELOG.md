# Changelog

## Unreleased

- Rename the external-state subpath from `@signature-kit/react/builder` to `@signature-kit/react/sync-store` and reuse it in the docs app.
- Export Schema-first certificate snapshots, hook outcomes, signer rows, and signer snapshots from `@signature-kit/react/config`.

## 0.1.0

- Initial hooks-only package for React browser A1 signing.
- Adds headless browser A1 hooks: certificate loading, sequential PDF signing,
  and PDF object-URL lifecycle helpers.
- Publishes hooks and headless data seams only. UI components are distributed
  through the docs-hosted shadcn registry instead of an npm `components` export.
