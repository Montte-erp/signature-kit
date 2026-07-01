# SignatureKit Agent Guidelines

SignatureKit is open-source, Effect-native infrastructure for digital-signature
runtimes. A1 / PKCS#12 is the first backend, not the product definition.

## Language and naming

- Code identifiers, file names, and public API names are English only.
- Keep APIs boring, typed, explicit, KISS. One clear Schema over clever wrappers.
- Boring names win: `parseCertificate`, `a1SignaturesLayer`, `signatures.sign`.

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
  `Effect.provide` is allowed in tests, application/runtime boundaries, and docs;
  package internals should expose requirements in the Effect environment.
- Timeout/retry policy uses `Duration` and `Schedule`. Retry must be classified.
- Secrets stay `Redacted` until the explicit serialization/import boundary.
- No `runSync` / `runPromise` / `runFork` / `Schema.decodeUnknownSync` in library internals.
- Stateful/global setup is a service dependency. Example: XML-DSig requires
  `XmlRuntime`/`xmlRuntimeLayer`; callers provide it explicitly instead of relying
  on import-time mutation or hidden module flags.
  Runtime marker services must expose a real capability (for example
  `XmlRuntime.parse`) instead of sentinel booleans like `{ configured: true }`.
- Never read ambient process state (`NODE_ENV`, env vars, globals) inside package
  internals to choose behavior. Decode explicit config through Schema or require a
  provided service/layer.

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
- Do not add parallel internal error/result channels next to an existing
  `TaggedErrorClass`. Low-level parsers and decoders should return typed
  `Effect` failures directly; only total pure primitives may stay plain values.
- When a foreign SDK rejects with a documented structural error, validate that
  shape with `Schema.decodeUnknownEffect` before mapping it. If the rejected
  cause does not match a documented shape, let it remain a defect.
- Preserve structured origin metadata only when the source is typed or
  protocol-defined (`operation`, `phase`, `schemaName`, `issueMessage`, HTTP
  `status`, upstream tagged-error `_tag`/`code`). Do not use `String(error)` as
  the only data.
- Do not hand-roll schema-issue metadata extractors — a recursive
  `schemaIssueLeafMetadata` / `schemaErrorMetadata(error)` that walks a schema
  issue is exactly the wrapper to delete. Effect already formats decode failures:
  use `String(issue)` for human text, or `SchemaIssue.makeFormatterStandardSchemaV1`
  only when callers genuinely need structured Standard Schema issues. Keep only
  the typed fields you use (usually `schemaName` + `issueMessage`). A cause with
  no decoded contract is a defect, not metadata to launder.
- Schema decode failures are mapped where the schema is decoded. Do not add
  shared `decodeRemoteShape` / `decodeRemoteOptions`-style wrappers that hide the
  decision point; use `Schema.decodeUnknownEffect(...).pipe(Effect.mapError((issue) =>
  new TaggedError({ ..., reason: String(issue) })))` inline at the provider,
  resource, or public API boundary.
- Default error-message catalogs are source-of-truth data next to the
  `TaggedErrorClass`, backed by Schema-derived entry types. Docs/apps import that
  exported catalog instead of duplicating literal code/message tables.
- HTTP errors must never serialize secrets. If an upstream forces credentials into
  a URL query string, carry the real transport URL separately from a redacted
  diagnostic URL and use only the diagnostic URL in `SignatureKitError.reason`.

## Schema and type rules

- Prefer `Schema` as the source of truth for data/config contracts; derive types.
- Use `Schema.Literals([...])` for literal catalogs (codes, statuses, operations).
- No `as` casts, including `as const`. Validate/convert through Schema/Effect, keep
  literal catalogs in `Schema.Literals([...])`, or model data as discriminated
  unions so reads narrow without assertions.
- No manual interfaces for config/data contracts when `Schema` can derive the type.
- If public docs need an example value for a Schema-backed contract, make the
  snippet use the real contract shape (`contentBase64` for remote resource props,
  not byte-only helper input) so examples do not become a parallel API.

## Effect 4 idioms

- Wrap an external library/SDK or stateful runtime as a `Context.Service` that
  exposes typed `Effect` methods plus a `raw` escape hatch only when the SDK has a
  useful underlying client contract. Construct it via `Layer`; keep secrets
  `Redacted` and unwrap only at the SDK call.
- Adapt SDK promises with `Effect.tryPromise`; in `catch`, construct the tagged
  error directly with explicit operation/reason/status metadata. Do not add error
  wrapper helpers, `safeCauseMetadata`/`toCauseMetadata`, or `instanceof` branches.
  Push typing down to the wrapper so consumers only ever see tagged errors.
- Effect 4 renamed `Either` → `Result`: use `Effect.result` + `Result.isSuccess/`
  `isFailure`, not `Effect.either` / `effect/Either` (removed).
- Use `Effect.fn(function* (args) { ... })` for service and provider methods so
  argument inference is preserved. Reserve `Effect.fnUntraced` for deliberately
  untraced leaf helpers, not lifecycle methods.
- Use `Match.value(x).pipe(Match.when(...), Match.exhaustive)` for total branching.

## Alchemy v2 — a core architecture primitive

Alchemy v2 is not an optional integration package; it is the seam every
declarable, reconcilable, or persisted contract passes through. If something must
be declared, reconciled, or stored, it takes Alchemy's shape — never a bespoke
wrapper. The signer adapters are already modeled this way (each is a `Resource`
with a `Provider.effect` and a collection layer); follow that shape.
- Read the upstream v2 guides before changing provider or state-store shape:
  `https://v2.alchemy.run/guides/custom-provider/#declare-the-resource-constructor-the-tag`,
  `https://v2.alchemy.run/guides/infrastructure-layers/`, and
  `https://v2.alchemy.run/guides/custom-state-store/`.

- **The resource constructor is the tag.** One named string literal is the
  resource type, repeated identically in the type alias, the constructor const,
  and the export name — never derived, never repeated raw at call sites:
  `export type X = Resource<"Vendor.Thing", XProps, XAttributes>` and
  `export const X = Resource<X>("Vendor.Thing")`. Alchemy resolves providers by
  that literal at plan time.
  Import `Resource` from the root `alchemy` package, matching the upstream v2
  guide; use subpath imports only for dedicated modules such as
  `alchemy/Provider`.
- **One `reconcile`, plus `delete` — never separate create/update.** A provider is
  `Provider.effect(X, Effect.gen(/* acquire shared deps once */) → X.Provider.of({ reconcile, delete }))`.
  `reconcile` covers create AND update and decides which by inspecting
  `output`/`olds` (both `undefined` ⇒ greenfield create); `delete` returns void.
  Both are idempotent and treat a missing remote (404) as success. Build the
  service through the typed `X.Provider.of({ ... })` constructor.
- **Wire by visibility.** `Layer.provide` for private resource providers;
  `Layer.provideMerge` for public credential/auth machinery a consumer also needs.
  Bundle a provider collection as a `providers()` layer.
  A signer `providers(options)` layer may provide private credentials, but it must
  not bake in `signatureHttpClientLive`; transport remains a caller-provided
  `SignatureHttpClient` requirement.
- **Retained remote-signature requests are immutable.** If the upstream workflow
  cannot be safely updated or deleted after creation, say so in the provider:
  `reconcile` may return the cached `output`, `delete` may retain, and `diff`
  must not advertise replacement semantics it cannot execute. For those resources,
  return `noop` once `olds` exists instead of pretending a changed prop can be
  replaced.
- **Remote provider lifecycle APIs mirror upstream facts.** Keep the Alchemy
  `create...Request` resource as the reconcile entry point, and expose
  provider-specific `get`/`list`/`cancel`/`delete`/`download` functions only when
  the upstream really has those endpoints. These functions use provider schemas
  plus `SignatureHttpClient`, map remote status into `RemoteSignatureRequest.state`
  without lossy string helpers, and test path/method/auth redaction/binary
  downloads against a local HTTP server. Never fake list/delete behavior through
  Alchemy when the provider cannot perform it.
  Retained request providers use an explicit no-op `diff`, `read` a cached output
  to detect missing remotes, and `delete` only the provided output id. They must
  not enumerate account-wide resources when `output` is absent.
- **Infrastructure is layered: Service → Layer → Binding → Runtime.** A runtime
  contract is a `Context.Service`; a
  `Layer.effect(Service, Effect.gen(function* () { const r = yield* ResourceDecl; const client = yield* Binding(r); return { ...methods } }))`
  implements it over concrete resources; the consumption boundary `yield*`s the
  Service and never touches resources directly. Swappable backends are separate
  layers of the SAME service, named by suffix (`XServiceKv`, `XServiceR2`), so a
  backend swap is a one-line `Layer.provide` change. Resources carry stable logical
  ids, so two consumers providing the same layer collapse to one shared resource.
- **State stores are Effect layers too.** A custom store is a `Layer` providing a
  lazily-built `StateService` (defer init with `Effect.cached`; own a connection
  with `Layer.scoped` + `Effect.acquireRelease`). `set` is an idempotent upsert
  keyed on `(stack, stage, fqn)`; a missing `get` returns `undefined`, never an
  error; serialize only through `encodeState`/`reviveState` (they handle
  `Redacted`/`Date` — do not hand-roll JSON); reserve `StateStoreError` for
  transport faults, and let any other cause be a defect.

## Architecture taste

- No barrel files that only re-export. Package exports point at the real module
  (`@signature-kit/pdf/sign`, `@signature-kit/core/signatures`,
  `@signature-kit/xml/engine`) unless the package has one genuine root module.
  Keep package `exports`, `tooling/typescript/base.json` paths, and committed
  `dist/` entrypoints in lockstep; CI static checks should fail drift.
- Avoid `types.ts`. Keep schemas, `Schema.TaggedErrorClass` catalogs, and config
  together in `config.ts` when they belong to the same package.
- The signer backend is not the document format. A `SignerAdapter` owns "where the
  signing power comes from"; it must not own XML/PDF document mutation.
- `shared/*` packages are internal-only and unpublished (`@signature-kit/asn1`,
  `@signature-kit/crypto`, `@signature-kit/cms`). Public packages live in `core/`,
  `signers/`, and `formats/`; there is no `integrations/*` layer.
- Tests live with the package that owns the behavior. Browser-facing React tests
  belong in `formats/react/__tests__`; app packages keep only page/app smoke tests.
- No super-atomic files. Split a module only when it owns a genuinely separate
  concern; do not spawn one-symbol files or files that exist only to hold a single
  trivial helper. Code-split when it clarifies, not by reflex.
- No anxiety helpers. A helper earns its name by removing real duplication or
  naming a real concept. A function that only wraps a cause, renames a value, or
  re-guards something readable inline (a `toSafeMetadata`-style wrapper) just adds
  a reading hop and hides intent — inline it. With Effect + Alchemy the failure
  surface is known; an unexpected cause is a defect/panic, not a value to launder.
- Avoid copies that only placate types. If an API requires a mutable array, make
  the decoded schema or internal return type mutable instead of `Array.from(...)`.

## React and TanStack

React package APIs are headless and data-first: build validated builder state with
Effect/Schema, keep explicit stores outside render hot paths, read with selector
hooks, and expose `data-slot` anatomy plus class/style seams.

- **React stays intentionally narrow.** `@signature-kit/react` exposes only
  `config`, `builder`, `components`, and `browser-pdf` for browser A1 signing.
  Do not add provider-specific bridges, queues, or rendering adapters
  (`react-pdf`, DocuSeal, remote signer flows) to this package; apps own those.
  Future browser PDF/XML work extends through core document seams, not new
  package-level state machines.

- **The store lives outside React.** Browser demos use a tiny module-level sync
  store (`createSyncStore`) and subscribe with `useSyncExternalStore`; never
  allocate app state with `useRef`/`useState`/`useMemo` in render and never mirror
  external store state into component-local state. Module-level functions write
  via `store.setState(...)`; React only subscribes and renders.
- **Signature queues are Effect programs, not Pacer/TanStack state machines.**
  Keep queue state boring and explicit (`busy`, per-document rows/status,
  active document id). Seed demo queues at module load or event boundaries with
  `Effect.runPromise(...)`; derive UI progress from the store fields the worker
  writes, and reset `busy` in the same Effect program that owns the batch. Do not
  add `@tanstack/react-pacer`/`@tanstack/react-store` unless a package feature
  genuinely requires them.
- **Best-guess placement stays pure geometry.** Do not spin up pdf.js/LiteParse
  per document just to place the default signature rectangle. Use the parsed
  `pageDims` already owned by `@signature-kit/pdf` and run the placement queue at
  concurrency 1 so focus/progress paints per document without racing.
- **Rubric queues never stamp the main signature page.** "Rubric every page"
  means every page except the page that receives the full visible signature
  block. Use `rubricPageIndexesExcludingSignature(...)`; single-page documents
  skip the rubric pass and receive only the main block.
- **Effects are a last resort in React.** Prefer callback refs,
  `useSyncExternalStore`, and event-boundary `Effect.runPromise(...)`. A React
  effect is allowed only for unavoidable resource loading, with explicit
  cancellation/cleanup; never add a mount effect solely to seed or drain a queue.
  Create and revoke object URLs inside the action that needs them.
- **Compose shadcn, not raw chrome.** Build UI from `components/ui/*` primitives
  (`Button` / `Badge` / `Card` / `Dialog` / `ScrollArea`); never hand-style a raw
  `<button>`/`<div>`. Merge classes with `cn`.
- **Server by default; isolate heavy client libs.** Sections are server components
  unless they need interactivity; async server work (shiki highlight) runs on the
  server and is handed to clients as pre-rendered nodes. Load heavy client-only
  libs (pdf-lib, pdf.js) via `dynamic(() => import(...), { ssr: false })` so they
  never run during SSG prerender.
- **i18n is request-scoped and canonical.** Call `setServerLocale(lang)` at the top
  of EVERY server segment that renders translated chrome (layout and each page
  render independently). Locales are canonical and case-sensitive (`en-US`,
  `pt-BR`), shared verbatim by URL, router, message catalog, and content suffix —
  never a casing map (lowercasing triggers a redirect loop).
- **Effect runs at the boundary only.** `runPromise` belongs in event handlers and
  queue workers; provide layers at that call site with `.pipe(Effect.provide(...))`.
  Never hide `runPromise` or `Effect.provide` in package internals — return the
  `Effect` and let the app boundary run it.
- **Docs display capabilities; packages own capabilities.** `apps/docs` can wire UI
  events and call package APIs, but PDF parsing, text-box collision detection,
  visible stamping, rubric placement, Effect queues, batch preparation, and
  signing behavior live in `@signature-kit/pdf` (or the owning format package).
  Browser-specific adapters such as LiteParse WASM still belong behind
  `@signature-kit/pdf` exports; docs imports those capabilities and shows the
  flow instead of reimplementing them.
- Use external apps (e.g. `app-licitei-next`) only to discover product needs; never
  copy their hook shapes, hardcoded options, or state leakage into public packages.

## Packages

```text
shared/asn1       @signature-kit/asn1       pure ASN.1 DER decode/encode (Effect boundary)
shared/crypto     @signature-kit/crypto     PKCS#12, PEM, hashing, cipher primitives
shared/cms        @signature-kit/cms        CMS/PKCS#7 and RFC 3161 timestamping
core/core         @signature-kit/core       runtime schemas, typed errors, Signatures service
core/certificates @signature-kit/certificates Effect-safe PKCS#12/X.509 certificate API
signers/a1        @signature-kit/a1         A1 / PKCS#12 local signer adapter
signers/clicksign @signature-kit/clicksign  Clicksign remote signer
signers/assinafy  @signature-kit/assinafy   Assinafy remote signer
signers/docuseal  @signature-kit/docuseal   DocuSeal remote signer
signers/documenso @signature-kit/documenso  Documenso remote signer
signers/zapsign   @signature-kit/zapsign    ZapSign remote signer
formats/xml       @signature-kit/xml        XML-DSig document mutation
formats/pdf       @signature-kit/pdf        PDF/PAdES detached-signature adapter
formats/react     @signature-kit/react      React builder state and browser A1 PDF signing helpers
```

## Validation

- Run `bun run check` at the repo root for all non-trivial changes.
- Generated `dist/` artifacts must mirror current package exports; delete stale
  generated files when a source/export is removed.
- Prefer static checks over ad-hoc review:
  - no `runSync`/`runPromise`/`runFork`
  - no `as` casts (`as Foo`/`as any`/`as unknown as`/`as const`)
  - no `throw`, `instanceof`, or library `try/catch`
  - no legacy Effect service APIs
  - no manual config/data contracts when `Schema` can derive the type
  - no hidden live transport in provider layers
  - no ambient `NODE_ENV` behavior selection
  - no stale `dist/` files or export/path alias drift
  - secrets use `Redacted`
- Tests for Effect workflows use `@effect/vitest` (or `bun test`).

## Done means

- `bun run check` was actually run and reported.
- Library internals remain substitutable via services/layers.
- Error conversion preserves enough structured context for debugging.
- No claim of "Effect-native" while throws, `as` casts, hidden `provide`, or erased
  error origins remain.
