# Workspace audit

The review compared this repository with the current architecture and testing rules in the local Olhary-v2 checkout. SignatureKit retains its own Effect, Alchemy, package, and browser contracts; application-specific persistence, router, and UI policies were not copied.

## Findings addressed

- Browser CI selected individual files and omitted the Card, locale, and Mermaid suites. Directory discovery now runs all 17 browser test files. Locale and Mermaid tests execute the real implementations with scoped cleanup.
- The default Vitest setup loaded developer environment variables while also discovering live provider tests. Five remote-provider suites now have explicit `.live.test.ts` names, are excluded from local discovery, and use a separate live configuration. Only that configuration loads `.env`.
- Release validation omitted browser, server, performance, site, and tarball checks. Release now depends on the reusable complete Checks workflow. Versioning runs before review; publication consumes the committed Tegami publish lock instead of generating an unreviewed version during publication.
- An empty required-span catalog retained a scanner, model, and execution branch without consumers. Removed that infrastructure and four unused normalization exports, preserving active observability rules.
- CMS byte-copy adapters duplicated native Uint8Array operations. Removed both internal wrappers without changing public exports. Added detached-CMS verification of offset views and rejection after content tampering.
- Five live suites duplicated the same PDF fixture generator. The existing fixture module now owns it. Provider list assertions use the test framework directly instead of a forwarding assertion helper.

## Verification

- Initial baseline: 60 local files passed, 570 tests passed, five live placeholders skipped.
- Updated local suite: 60 files, 571 tests, no skipped live placeholders.
- Browser: 17 files, 73 tests passed, including real Mermaid success/failure and locale changes.
- Server integration: one end-to-end signing test passed.
- Performance: three files, five tests passed. This establishes existing budgets, not a measured speedup.
- Package build, static/type checks, production site build, and dry-run packing of all 17 public packages passed locally.
- Tegami generated CMS 0.2.2 and validated the publish lock in dry-run mode. CI and npm publication require separate remote evidence.
- Live signer APIs and ITI were not called. Their discovery was checked without importing tests or contacting providers.

## Effect-aware lint follow-up

The installed `@effect/tsgo` integration now patches Oxlint through the root prepare
script, using the compatible pinned Oxlint and tsgolint versions. The native
correctness preset and selected simplification rules run for packages and docs.
A regression test executes the installed patched linter against valid and invalid
programs, so CI detects an absent patch or missing type analysis.

Removed redundant void mappings, chained pipes, a single-consumer buffer wrapper,
and release status forwarding helpers. The PDF viewer derives its no-observer
fallback without synchronous state updates inside its resource effect.

Two rule boundaries are intentional: `any-unknown-in-error-context` also flags
native Alchemy signatures and undecoded SDK failures, so it is disabled;
`effect-succeed-with-void` is not selected because the installed Effect version
returns void, which is incompatible with optional-value contracts returning
undefined. Build errors verified that distinction; public types were preserved.

Follow-up verification: build and all checks passed; 571 local tests in 61 files,
73 browser tests, and five performance tests passed. The live ITI integration
also passed using the committed fixture and its expected validator response.
Remote signer creation APIs were not called. The extra package cleanups have a
pending Tegami entry; the existing CMS publish lock remains unchanged.

## Remaining debt

This is not a claim that every package or test satisfies every written rule.

- HTTP, timestamp, ICP-Brasil, PDF, browser-hook, and release tests still contain global patches, spies, or fake timers. Replace complete behavior boundaries while retaining their failure cases; do not simply delete them to make a mock-free claim.
- Static checks still combine a handwritten text normalizer and regex checks with TypeScript AST inspection. Template interpolation, aliases, and scope resolution need a dedicated parser-based migration and regression cases.
- The Alchemy test helper supplies a handwritten plan-status session. Replacing it requires validating the installed native Alchemy test runtime and preserving local provider isolation.
- Broad docs exemptions in static checks and existing React lifecycle patterns need separate assessment against the package's browser contract. Rules copied from another product are not sufficient evidence to rewrite them.
