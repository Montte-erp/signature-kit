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
- Effect-boundary escape comments use `[allow-run: <reason>]` or
  `[allow-string-secret: <reason>]`; the reason is required, and these comments
  are allowed only under `formats/react/src/` and `apps/docs/`.
- Use static imports for modules known at author time. Dynamic import is only for
  runtime-selected plugins, platform-specific modules, or test cases that
  explicitly exercise module loading; add a short comment naming the exception.
- Stateful/global setup is a service dependency. XML-DSig is exposed through
  `XmlRuntime`/`xmlRuntimeLayer`, whose real capabilities include parsing,
  `SignedXml` construction, and cached verification-key import.
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
  `TaggedErrorClass`, backed by Schema-derived entry types. Apps resolve
  localized display copy by code through `@signature-kit/i18n`, never by
  matching `reason` text.
- HTTP errors must never serialize secrets. If an upstream forces credentials into
  a URL query string, carry the real transport URL separately from a redacted
  diagnostic URL and use only the diagnostic URL in `SignatureKitError.reason`.

## Schema and type rules

- Prefer `Schema` as the source of truth for data/config contracts; derive types.
- Use `Schema.Literals([...])` for literal catalogs (codes, statuses, operations,
  hash algorithms). Hash/algorithm catalogs stay in the owning package, and total
  maps use `Match.exhaustive` instead of hand unions or ternary chains.
- Use top-level `import type` declarations for type-only dependencies; do not
  hide package dependencies inside inline type annotations.
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
- Do not wrap pure hooks in generator functions. If a provider hook only returns
  `Effect.succeed(...)`, write a plain function; reserve `Effect.fn(function* ...)`
  for bodies that actually `yield*`.
- Use `Match.value(x).pipe(Match.when(...), Match.exhaustive)` for total
  branching, especially Schema-backed algorithm/status maps.
- Use `Effect.forEach` directly for bounded in-memory batches; it is sequential by
  default. Add `{ concurrency }` when calls are independent, preserve order only
  when the upstream protocol requires it, and add `discard: true` when the result
  array is intentionally unused.
- Use `Stream` for paginated or unbounded sequences (`Stream.paginate` +
  `Stream.runCollect` for provider list endpoints). Use `Sink` when a stream
  should be folded, counted, validated, or written without retaining every item.
- Use `Cache` for overlapping expensive lookups and Effect batching (`Request` /
  `Resolver`) for N+1 service/API reads. Keep both behind a service/layer seam;
  do not hand-roll mutable maps at call sites. A small per-adapter closure cache is
  acceptable only when the adapter constructor must remain pure and introducing a
  layer would force `runSync`.
- Use `Ref` only for cross-fiber mutable state owned by a service/layer. Pure
  builder/config data stays immutable values.
- Long-lived resources live in `Layer.scoped` with `Effect.acquireRelease`;
  short critical cleanup uses `Effect.ensuring`/`onExit`.

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
  Bundle a provider collection as a `providers(options)` layer.
  A signer `providers(options)` layer may provide private credentials, but it must
  not bake in `signatureHttpClientLive`; transport remains a caller-provided
  `SignatureHttpClient` requirement. At an Alchemy `StackProps.providers`
  boundary, provide transport explicitly and collapse provider-construction
  failures to defects so the stack gets a `Layer<never, never, StackServices>`:
  `providers(options).pipe(Layer.provide(signatureHttpClientLive), Layer.orDie)`.
- **Retained remote-signature requests are immutable.** If the upstream workflow
  cannot be safely updated or deleted after creation, say so in the provider:
  `reconcile` returns cached `output` after creation, `delete` only acts on a
  provided output id, and each signer owns its retained no-op `diff` locally so
  changed props never advertise update/replacement semantics the provider cannot
  execute. Provider `list` hooks for retained resources return `Effect.succeed([])`
  and set `nuke: { skip: true }`; never feed account-wide upstream enumeration
  into `alchemy nuke`. Package-level `list*SignatureRequests(options)` functions
  own upstream list endpoints.
- **Remote provider lifecycle APIs mirror upstream facts.** Keep the Alchemy
  `create...Request` resource as the reconcile entry point, and expose
  provider-specific `get`/`list`/`cancel`/`delete`/`download` functions only when
  the upstream really has those endpoints. These functions use provider-owned
  schemas plus `SignatureHttpClient`, map remote status into the signer
  package's local state model without lossy string helpers, and test
  path/method/auth redaction/binary downloads against a local HTTP server. Never
  fake list/delete behavior through Alchemy when the provider cannot perform it.
  JSON response decoding belongs in `SignatureHttpClient.requestJson(request,
  schema, schemaName)`, not repeated after each remote call. The HTTP seam owns
  parse failures, schema decode failures, provider/status metadata, and redacted
  diagnostic URLs.
  Decode Alchemy resource `news` inside the signer package with that provider
  domain's resource-props Schema. Do not put remote-signature request,
  recipient, document, provider, status, schema-name, or retained-diff contracts
  in core or in a new shared hub. Encode provider capabilities in that local
  schema: single-document and single-PDF providers use a tuple/refinement there
  instead of runtime rejecting a generic shape.
  Retained request providers use their local no-op `diff`, `read` a cached output
  to detect missing remotes, and `delete` only the provided output id. Create-flow
  rollback deletes remote state only on unambiguous pre-effect 4xx failures; never
  for 408, 409, 429, 5xx, timeout, response-shape failures, or after notifications
  are dispatched. Signed-document downloads first read state and fail with typed
  `unsupportedOperation` before completion.
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

- Core is a set of focused provider-agnostic packages: `@signature-kit/signatures`
  owns certificate contract schemas, byte-signing contracts, `Signatures`, and
  `SignatureKitError`; `@signature-kit/http` owns `SignatureHttpClient` transport;
  `@signature-kit/certificates` owns PKCS#12/X.509 parsing. There is no umbrella
  core package and no standalone errors package. Signers depend on focused core
  packages; core never imports or enumerates signer, format, or validator packages.
  `konsistent` enforces source-level dependency direction imports; static
  workspace checks enforce manifests, TypeScript references, and export/path alias
  lockstep. Package exports point at `dist/` files built by `tsc`; CI builds
  before tests because `dist/` is gitignored.
- Workspace packages imported only by tests belong in `devDependencies`; runtime
  source imports belong in `dependencies`.

- No barrel files that only re-export. Package exports point at the real module
  (`@signature-kit/pdf/sign`, `@signature-kit/signatures`,
  `@signature-kit/xml/engine`) unless the package has one genuine root module.
  `konsistent` enforces this and the remote-signer package shape.
  Source filenames should name the real seam too: keep `@signature-kit/a1/signer`
  backed by `src/signer.ts`, and keep `@signature-kit/asn1` backed by an ASN.1 API
  module rather than a misleading `config.ts` root.
- Avoid `types.ts`. Keep schemas and `Schema.TaggedErrorClass` catalogs beside
  the API they validate — usually `config.ts`, or the package root module when the
  root specifier is the real API.
- The signer backend is not the document format. A `SignerAdapter` owns "where the
  signing power comes from"; it must not own XML/PDF document mutation.
- `shared/*` packages are low-level support packages that may be published so
  public packages install cleanly from npm, but they are not the product surface.
  Keep their exports narrow and dependency-driven. Public product packages live in
  `core/`, `signers/`, `formats/`, and `validators/`; there is no `integrations/*`
  layer. Validators may depend on core/shared/formats, never on signers, and remote
  validator transport goes through `SignatureHttpClient`.
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

React package APIs are hooks-only and data-first: build validated A1 browser
signing state with Effect/Schema, keep explicit stores outside render hot paths,
and expose headless certificate/signer/browser-PDF hooks. UI components are not
npm-published; apps consume the shadcn registry copies they own.

- **React stays intentionally narrow.** `@signature-kit/react` exposes headless
  hooks and the data seams those hooks need (`a1`, `config`, `builder`,
  `browser-pdf`). It does not expose UI components, provider-specific bridges,
  app queues, fetch/tRPC glue, storage, toasts/modals, rendering adapters
  (`react-pdf`, DocuSeal, remote signer flows), or app state. Future browser
  PDF/XML work extends through core document seams and hooks, not package-level
  UI state machines.

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
- **Effect runs at the boundary only.** `runPromise` belongs in app event handlers,
  queue workers, docs, and ratified `@signature-kit/react` hook actions. The React
  package's product is hooks, so their event-actions are app boundaries like docs
  event handlers. Provide layers at that call site with `.pipe(Effect.provide(...))`.
  Never hide `runPromise` or `Effect.provide` in package internals — return the
  `Effect` and let the app boundary run it.
- **Docs display capabilities; packages own capabilities.** `apps/docs` can wire UI
  events and call package APIs, but PDF parsing, anchor text search, text-box
  collision detection, visible stamping, vector initials rubrics, high-level
  prepare-and-sign workflows, rubric placement, Effect queues, batch preparation,
  and signing behavior live in `@signature-kit/pdf` (or the owning format
  package). Browser-specific adapters such as LiteParse WASM still belong behind
  `@signature-kit/pdf` exports; docs imports those capabilities and shows the
  flow instead of reimplementing them.
- Use external apps (e.g. `app-licitei-next`) only to discover product needs; never
  copy their hook shapes, hardcoded options, or state leakage into public packages.

## Packages

```text
shared/asn1       @signature-kit/asn1       pure ASN.1 DER decode/encode (Effect boundary)
shared/crypto     @signature-kit/crypto     PKCS#12, PEM, hashing, cipher primitives
shared/cms        @signature-kit/cms        CMS/PKCS#7 and RFC 3161 timestamping
core/signatures  @signature-kit/signatures runtime schemas, typed errors, Signatures service
core/i18n       @signature-kit/i18n       locale schemas and error-message lookup
core/http        @signature-kit/http       HTTP client service and transport schemas
core/certificates @signature-kit/certificates Effect-safe PKCS#12/X.509 certificate API
signers/a1        @signature-kit/a1         A1 / PKCS#12 local signer adapter
signers/clicksign @signature-kit/clicksign  Clicksign remote signer
signers/assinafy  @signature-kit/assinafy   Assinafy remote signer
signers/docuseal  @signature-kit/docuseal   DocuSeal remote signer
signers/documenso @signature-kit/documenso  Documenso remote signer
signers/zapsign   @signature-kit/zapsign    ZapSign remote signer
formats/xml       @signature-kit/xml        XML-DSig document mutation
formats/pdf       @signature-kit/pdf        PDF/PAdES detached-signature adapter
formats/react     @signature-kit/react      hooks-only browser A1 signing helpers
validators/iti     @signature-kit/iti       ITI local and remote signature conformance validation
```

## Validation

- For non-trivial changes run `bun run build && bun run check && bun run test` at
  the repo root. `build` is required first because package exports point at
  `dist/` entrypoints generated by `tsc`; CI builds before tests and `dist/` stays
  gitignored.
- Prefer structural and static checks over ad-hoc review:
  - `bun run check:konsistent` validates `konsistent.json` and enforces
    structural conventions: source dependency-direction imports, no barrel-only
    source modules, required package files, and remote-signer index surfaces.
  - `bun run check:declarative-errors` owns content-level bans and manifest/
    workspace checks that `konsistent` cannot express.
  - no `runSync`/`runPromise`/`runFork` in library internals
  - no `as` casts (`as Foo`/`as any`/`as unknown as`/`as const`)
  - no inline import-type annotations or unnecessary dynamic imports
  - no `throw`, `instanceof`, or library `try/catch`
  - no legacy Effect service APIs
  - no manual config/data contracts when `Schema` can derive the type
  - no hidden live transport in provider layers
  - no ambient `NODE_ENV` behavior selection
  - no stale `dist/` files or export/path alias drift
  - secrets use `Redacted`
- Tests for Effect workflows use `@effect/vitest` (or `bun test`). Offline
  remote-signer suites use a local HTTP server as a scoped resource
  (`Effect.acquireRelease`); handlers record requests and assertions live in test
  bodies. No `try/finally` and no casts, even in tests.
- PDF/PAdES changes must run the local PDF suite plus the relevant matrix:
  `bunx vitest run formats/pdf/__tests__` for local behavior,
  `bun run test:integration:browser` for Chromium A1 signing,
  `bun run test:validar-iti` (with `SIGNATURE_KIT_ITI_VALIDATE=1` and optional
  external certificate env) for the live ITI validator, and
  `bun run test:performance` when byte-range, stamping, signing, or parsing hot
  paths change. PDF verification fails closed on non-conforming `/Contents`, but
  tolerates ISO-32000-legal whitespace and odd-hex forms; unsigned holes must be
  zero or whitespace padding.

## Done means

- `bun run build && bun run check && bun run test` was actually run and reported.
- Library internals remain substitutable via services/layers.
- Error conversion preserves enough structured context for debugging.
- No claim of "Effect-native" while throws, `as` casts, hidden `provide`, inline
  type imports, unnecessary dynamic imports, or erased error origins remain.
