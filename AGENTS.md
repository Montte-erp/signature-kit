# SignatureKit Agent Guidelines

SignatureKit is open-source, Effect-native infrastructure for digital-signature
runtimes. A1 / PKCS#12 is the first backend, not the product definition.

## Language and naming

- Code identifiers, file names, and public API names are English only.
- Keep APIs boring, typed, explicit, KISS. One clear Schema over clever wrappers.
- Boring names win: `parseCertificate`, `createA1SignerAdapter`, `signatures.sign`.

## Effect-native rules

- Public APIs return typed `Effect.Effect` values from `effect`.
- Recoverable technical faults stay in the typed Effect error channel.
- Mandatory invariants hard-fail with Effect defects or schema decode failures.
  Do not silently fall back for required configuration or impossible states.
- Use `Context.Service` + `Layer` (v4) for services and dependencies. Do not use
  `Context.Tag`, `Context.GenericTag`, `Effect.Tag`, or `Effect.Service`.
  (`Context.Tag` is the Effect 3 API and does not exist in Effect 4; Alchemy v2
  code uses `Context.Service` + `Layer` for portable seams.)
- Do not hide requirements with `Effect.provide` deep inside library code.
  `Effect.provide` is allowed in tests, runtime boundaries, or small convenience
  factories with an explicit `// effect-boundary: <reason> [allow-provide]` marker.
- Timeout/retry policy uses `Duration` and `Schedule`. Retry must be classified.
- Secrets stay `Redacted` until the explicit serialization/import boundary.
- No `runSync` / `runPromise` / `runFork` / `Schema.decodeUnknownSync` in library internals.

## Error rules

- Errors are native Effect errors: `Schema.TaggedErrorClass` with a literal code
  catalog (`Schema.Literals([...])`) in the package `config.ts`.
- Construct the tagged error at the exact decision point.
- Do not create ad-hoc error/factory helpers like `makeProviderError`,
  `parseFailure`, `responseShapeFailure`, or any `*Error`/`*Failure`/`*Fault` name
  outside the `TaggedErrorClass` definition.
- Do not `throw` (no `throw new Error`, no re-throw), use library-level `try/catch/`
  `finally`, or build runtime error wrapper classes. Promise/IO adaptation uses
  `Effect.tryPromise` / `Effect.try` with an inline declarative `catch` that
  constructs a tagged error.
- Do not use `instanceof` for error/cause classification. At SDK boundaries,
  construct a tagged error with the exact operation, a stable human reason,
  known protocol facts (HTTP `status`, schema issue fields), and no generic
  unknown-cause metadata wrapper. If the cause has no real contract, let it be
  a defect instead of pretending it is typed.
- Preserve structured origin metadata only when the source is typed or
  protocol-defined (`operation`, `phase`, `schemaName`, `issuePath`,
  `issueMessage`, HTTP `status`, upstream tagged-error `_tag`/`code`).
  Do not use `String(error)` as the only data.

## Schema and type rules

- Prefer `Schema` as the source of truth for data/config contracts; derive types.
- Use `Schema.Literals([...])` for literal catalogs (codes, statuses, operations).
- No `as` casts, including `as const`. Validate/convert through Schema/Effect, keep
  literal catalogs in `Schema.Literals([...])`, or model data as discriminated
  unions so reads narrow without assertions.
- No manual interfaces for config/data contracts when `Schema` can derive the type.

## Effect 4 idioms (aligned with Alchemy v2)

- Wrap an external library/SDK as a `Context.Service` that exposes typed `Effect`
  methods plus a `raw` escape hatch to the underlying client. Construct it via
  `Layer`; keep secrets `Redacted` and unwrap only at the SDK call.
- Adapt SDK promises with `Effect.tryPromise`; in `catch`, construct the tagged
  error directly with explicit operation/reason/status metadata. Do not add error
  wrapper helpers, `safeCauseMetadata`/`toCauseMetadata`, or `instanceof` branches.
  Push typing down to the wrapper so consumers only ever see tagged errors.
- Effect 4 renamed `Either` → `Result`: use `Effect.result` + `Result.isSuccess/`
  `isFailure`, not `Effect.either` / `effect/Either` (removed).
- `Effect.fnUntraced(function* () { ... })` defines an effectful function;
  `Match.value(x).pipe(Match.when(...), Match.exhaustive)` for total branching.
- Alchemy v2 patterns apply to this repo's seams: resource/provider modules use
  `Resource<T>(type)` as the constructor/tag, providers use `Provider.effect`,
  provider bundles expose a `providers()` layer, runtime seams are
  `Context.Service` contracts implemented by `Layer.effect`, and expensive or
  stateful initialization is deferred/cached instead of running at import time.

## Architecture taste

- No barrel files that only re-export. Package exports point at the real module
  (`@signature-kit/pdf/sign`, `@signature-kit/core/runtime`, etc.) unless the
  package has one genuine root module.
- Avoid `types.ts`. Keep schemas, `Schema.TaggedErrorClass` catalogs, and config
  together in `config.ts` when they belong to the same package.
- The signer backend is not the document format. A `SignerAdapter` owns "where the
  signing power comes from"; it must not own XML/PDF document mutation.
- `shared/*` packages are internal-only and unpublished (`@signature-kit/asn1`,
  `@signature-kit/crypto`, `@signature-kit/cms`). Public packages live in `core/`,
  `signers/`, and `formats/`; there is no `integrations/*` layer.

## Packages

```text
shared/asn1       @signature-kit/asn1       pure ASN.1 DER decode/encode (Effect boundary)
shared/crypto     @signature-kit/crypto     PKCS#12, PEM, hashing, cipher primitives
shared/cms        @signature-kit/cms        CMS/PKCS#7 and RFC 3161 timestamping
core/core         @signature-kit/core       runtime schemas, typed errors, Signatures service
core/certificates @signature-kit/certificates Effect-safe PKCS#12/X.509 certificate API
signers/a1        @signature-kit/a1         A1 / PKCS#12 local signer adapter
signers/docusign  @signature-kit/docusign   DocuSign remote signer
signers/clicksign @signature-kit/clicksign  Clicksign remote signer
signers/assinafy  @signature-kit/assinafy   Assinafy remote signer
signers/zapsign    @signature-kit/zapsign    ZapSign remote signer
formats/xml       @signature-kit/xml        XML-DSig document mutation
formats/pdf       @signature-kit/pdf        PDF/PAdES detached-signature adapter
```

## Validation

- Run `bun run check` (or `bun run check:static`) at the repo root.
- Prefer static checks over ad-hoc review:
  - no `runSync`/`runPromise`/`runFork`
  - no `as` casts (`as Foo`/`as any`/`as unknown as`/`as const`)
  - no `throw`, `instanceof`, or library `try/catch`
  - no legacy Effect service APIs
  - no manual config/data contracts when `Schema` can derive the type
  - secrets use `Redacted`
- Tests for Effect workflows use `@effect/vitest` (or `bun test`).

## Done means

- `bun run check` was actually run and reported.
- Library internals remain substitutable via services/layers.
- Error conversion preserves enough structured context for debugging.
- No claim of "Effect-native" while throws, `as` casts, hidden `provide`, or erased
  error origins remain.
