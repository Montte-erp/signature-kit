# @signature-kit/react

Headless React hooks for browser A1 signing.

The package is intentionally hooks-only. It does not publish UI components, storage, fetch/tRPC glue, toasts, modals, or `react-pdf` adapters. Apps own UI code directly or install the docs-hosted shadcn registry components into their own source tree.

## Exports

- `@signature-kit/react/a1` — `useA1Certificate()` and `useA1Signer()`.
- `@signature-kit/react/browser-pdf` — `usePdfObjectUrl(bytes)`.
- `@signature-kit/react/builder` — tiny external-store helpers for headless React state.
- `@signature-kit/react/config` — Schema-backed hook input contracts and public hook state types.

Certificate persistence is not included. If an app remembers a password or encrypted PFX bytes, it owns that storage policy and passes fresh inputs back to the hooks.
