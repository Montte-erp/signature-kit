---
packages:
  "@signature-kit/http": patch
  "@signature-kit/xml": patch
  "@signature-kit/crypto": patch
  "@signature-kit/iti": patch
---

## Simplify Effect programs

Use native void effects and value-discarding combinators while preserving public success, error, and dependency contracts. The workspace now enforces Effect correctness and selected simplification rules through the official Effect TypeScript-Go integration with Oxlint.
