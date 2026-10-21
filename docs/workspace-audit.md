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


## Dependency and feature update - 2026-10-21

Updated all direct dependencies to their current releases, including stable Effect 4, Vitest 5, React 19.3, Alchemy v2, Nx, Oxlint, Oxfmt, and the documentation stack. The Effect Oxlint integration uses the upstream-supported pinned combination; the installed-binary regression test remains part of the local suite. General TypeScript, import, promise, and Unicorn rules were reviewed and enabled with warnings denied. SignatureKit retains its own architecture policies. Scripts and the root Vitest config now pass through lint too. The continuation audit added native Effect antipattern checks, Schema.Finite checks, native control-flow simplifications, strict boolean checks, and JSX accessibility checks. Actual application/test boundaries retain explicit provide exceptions; raw negative SDK tests can inspect upstream rejections. Published library source cannot use unknown Promise errors. Existing zero-argument service methods retain their public contracts instead of breaking consumers to satisfy a style suggestion.

Compatibility constraints are deliberate:

- TypeScript 7.0.2 owns `tsc`, builds, and type checks. Following [the official Nx side-by-side configuration](https://nx.dev/docs/kb/typescript-7), the `typescript` alias resolves to Microsoft's `@typescript/typescript6` compatibility package for existing compiler-API consumers. No custom compiler wrapper or Nx provider was introduced.
- CMS and ITI use ASN.1 v4 while PKI.js retains its compatible transitive version. SDK values cross this boundary as DER bytes, and RFC 3161 requests use the native `@peculiar/asn1-tsp` contract. No ASN.1 override is required. An isolated installation of all 17 locally packed packages validates the committed PAdES fixture with every conformance attribute valid; only internal SignatureKit package versions are selected from local tarballs.
- The Waku override keeps Fumapress and the app on one runtime, avoiding duplicate root contexts.
- The Hono Node adapter patch forwards the native Request `duplex` getter in both ESM and CommonJS builds. Real local HTTP GET and POST tests failed before the patch and passed afterward. The patch fixes production dynamic-route failures without changing runtimes or patching globals in tests.

Added capabilities:

- XML verification validates the declared signature method against its RSA URI catalog before reaching WebCrypto. Documented XML SDK rejections are schema-decoded; unexpected SDK causes remain defects rather than generic typed wrappers.
- `inspectCertificateValidity` reports the validity state, evaluation time, remaining milliseconds, and whole days until expiry. It validates intervals and uses the Effect clock. Certificate parsing uses the same clock for its validity snapshot.
- `verifyPdfSignatures` exposes each signature's cryptographic result, revision coverage, chain result, revocation status, byte range, signer serial number, and revision end. Aggregate verification shares that implementation. Tests cover two real A1 signatures and tampering.
- Every remote signer exposes `waitFor*SignatureRequest`, with a validated positive finite Duration and native Schedule polling. Final states include unsuccessful outcomes. Read failures propagate, interruption stops polling, and applications own deadlines and retry policy.

Migrated Fumapress types, metadata, and feed integration to the installed contracts. Framework routes own the locale redirect and robots response. Converted 156 documentation links to canonical localized URLs and retained the build's link-validation gate. The registry derives its pinned external versions from the docs manifest. PDF.js cleanup now uses the owning loading task. Browser fixtures use native Vite inline assets; the page-visibility regression uses the real IntersectionObserver.

Verification recorded locally:

- Public package build and static/type checks, including docs and tests.
- 600 local tests in 68 files; 73 Chromium tests in 17 files. The final local rerun used `bun run test --maxWorkers=4` after a concurrent site build caused the workspace-graph audit to exceed its five-second timeout; the complete rerun passed without changing the test timeout.
- One server integration test and five performance tests across three files.
- Live ITI validation with the committed public fixture: expected HTTP 406 and untrusted-certificate outcome, not an approved certificate claim.
- Production site build with link validation; dry-run packing of all 17 public packages; frozen-lockfile installation. An independent temporary consumer installs those 17 actual tarballs outside the workspace and passes PDF conformance without external dependency overrides.
- Nine HTTP probes against the built production server: locale redirect, both home pages, English PDF docs, Portuguese certificate docs, robots, sitemap, and both localized RSS feeds. Every final response was HTTP 200; XML responses parsed successfully. The test server was stopped afterward.

The new Tegami entry records the dependency migration and added APIs. The existing pending publish lock was preserved. No remote signer creation calls, npm publication, Git push, CI run, or deployment was performed in this round. Existing mock-based tests listed above remain migration debt; this work does not claim to remove every historical violation.

## Branded stamps, PDF handling, and browser workers - 2026-10-21

The PDF badge contract now supports PNG logos and handwritten marks with independent, proportional image placement. The demo exposes logo upload/removal, title and color controls, a larger initial stamp, and a preview rendered from the actual PDF API. The preview is acquired only in the stamp step, cancels on replacement/unmount, releases PDF.js loading/render tasks, and displays a localized error when rendering fails.

`PdfWorker` uses native Effect RPC. Its browser layer owns worker lifetime through acquire/release and terminates on scope closure. PDF preparation and preview rendering run in the worker; progress callbacks remain in the page. Original PDF buffers and signing dates survive the transport. Certificate/password material is outside the worker request contract.

Reproduced failures and fixes:

- Structured batch stamps passed both badge and legacy ink/border options into a lower-level API that rejected that combination. The batch owner now normalizes handwritten content into the badge and leaves its visual theme in charge of the frame.
- A badge at or below its padding could generate an unusable drawing. It now returns a typed stamp failure.
- Premeasured values such as `TrustSign Tests` were wrapped again by PDF drawing and overlapped the next row. The drawing call now preserves the single line already measured by the layout. A PDF text-stream regression failed before the fix and passed afterward.
- React StrictMode replay disposed the signer controller permanently, silently blocking file input. Explicit activation on mount and lifecycle checks for pending placement leases retain cleanup while allowing the replay. A Chromium test with a real PDF failed before the fix and passed afterward, with no SDK doubles.
- Custom demo routes were localized twice by the installed Fumapress contract. The registration now uses explicit `lang` and unprefixed paths; production route and browser probes exercise the actual pages.

Validation includes 604 local tests, 80 Chromium tests, all package builds/static/type checks, server integration, performance, live ITI fixture validation, site build/link validation, and packing. New worker tests execute real browser workers and real A1 signing/verification; they cover malformed PDFs, invalid images/dimensions, date preservation, interruption, subsequent sessions, progress, and caller-buffer preservation. Existing historical mocks are not represented as new worker evidence.

The collaborative browser also completed a production-local flow with a four-page rotated/cropped PDF, public A1 fixture, custom logo/title, and download. The downloaded file has one cryptographically valid signature with complete revision coverage. Verification supplied no trusted roots; certificate-chain trust and revocation were not established. Raster inspection exposed the text wrapping regression; the corrected renderer was inspected again with the same logo/name content.

No npm publication, push, CI run, deployment, or live remote-signer writes were performed for these changes.

The final production build returned HTTP 200 for ten probes: root locale redirect, both home pages, the Portuguese signing demo, both relevant documentation pages, robots, sitemap, and both localized RSS feeds. XML responses parsed successfully and the production-local test server was stopped. Frozen-lockfile installation and all 17 package packing targets passed.
