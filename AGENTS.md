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
  (`Context.Tag` is the Effect 3 API and does not exist in Effect 4 — it only shows
  up in alchemy-effect's docs page, never in its code, which uses `Context.Service`.)
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
- `instanceof` IS allowed for narrowing an unknown/external cause at an adaptation
  boundary (e.g. classifying a thrown SDK `Error` to map it to a tagged error — the
  alchemy-effect idiom). Prefer `Effect.catchTag` / `Match` for our own tagged
  errors; do not reach for `instanceof` where a tag already discriminates.
- Preserve safe structured origin metadata when converting at a boundary
  (`operation`, `phase`, `schemaName`, `issuePath`, `issueMessage`, `upstreamTag`,
  `upstreamCode`, HTTP `status`). Do not use `String(error)` as the only data.
- Do not branch on unknown caught error shapes unless a real contract requires it.

## Schema and type rules

- Prefer `Schema` as the source of truth for data/config contracts; derive types.
- Use `Schema.Literals([...])` for literal catalogs (codes, statuses, operations).
- No value-type `as` casts (`as Foo`, `as any`, `as unknown as Foo`). Validate/convert
  through Schema/Effect, or model data as a discriminated union so reads narrow
  without assertions. `as const` IS allowed: it is a safe const-assertion (narrows to
  literal/readonly types, cannot introduce unsoundness) and is heavily used in
  idiomatic Effect 4 code (alchemy-effect: 500+ uses).
- No manual interfaces for config/data contracts when `Schema` can derive the type.

## Effect 4 idioms (aligned with alchemy-effect)

- Wrap an external library/SDK as a `Context.Service` that exposes typed `Effect`
  methods plus a `raw` escape hatch to the underlying client (alchemy's
  `Binding.Service` pattern). Construct it via `Layer`, pulling secrets from a
  credentials service; keep them `Redacted` and unwrap only at the SDK call.
- Adapt the SDK's promises with `Effect.tryPromise`; in `catch`, narrow the unknown
  cause (`instanceof Error`, message/code inspection) and construct a tagged error.
  Push typing down to the wrapper so consumers only ever see tagged errors.
- Effect 4 renamed `Either` → `Result`: use `Effect.result` + `Result.isSuccess/`
  `isFailure`, not `Effect.either` / `effect/Either` (removed).
- `Effect.fnUntraced(function* () { ... })` defines an effectful function;
  `Match.value(x).pipe(Match.when(...), Match.exhaustive)` for total branching.

## Architecture taste

- No barrel files that only re-export. Entry points provide real public API.
- Avoid `types.ts`. Keep schemas, `Schema.TaggedErrorClass` catalogs, and config
  together in `config.ts` when they belong to the same package.
- The signer backend is not the document format. A `SignerAdapter` owns "where the
  signing power comes from"; it must not own XML/PDF document mutation.
- `shared/*` packages are internal-only and unpublished (`@signature-kit/asn1`,
  `@signature-kit/crypto`). Public packages live in `core/`, `signers/`, `formats/`,
  `integrations/`.

## Packages

```text
shared/asn1     @signature-kit/asn1     pure ASN.1 DER decode/encode (Effect boundary)
shared/crypto   @signature-kit/crypto   PKCS#12, PEM, hashing, cipher primitives
core/core       @signature-kit/core     signing runtime contracts + certificate handling
signers/a1      @signature-kit/a1        first e-signature adapter (A1 / PKCS#12)
```

## Validation

- Run `bun run check` (or `bun run check:static`) at the repo root.
- Prefer static checks over ad-hoc review:
  - no `runSync`/`runPromise`/`runFork`
  - no value-type `as` casts (`as Foo`/`as any`/`as unknown as`); `as const` is fine
  - no `throw`/library `try/catch`; `instanceof` allowed only for boundary cause-narrowing
  - no legacy Effect service APIs
  - no manual contract interfaces when `Schema` can derive
  - secrets use `Redacted`
- Tests for Effect workflows use `@effect/vitest` (or `bun test`).

## Done means

- `bun run check` was actually run and reported.
- Library internals remain substitutable via services/layers.
- Error conversion preserves enough structured context for debugging.
- No claim of "Effect-native" while throws, `as` casts, hidden `provide`, or erased
  error origins remain.
