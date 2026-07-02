# GOAL — finish the bug-fix pass (round 2)

Context: a first fix batch (uncommitted working tree) addressed the round-1 review but
**does not compile** (`tsc -b` fails in 5 packages) and several fixes are broken,
incomplete, or non-idiomatic per `AGENTS.md`. This goal lists exactly what remains.

Definition of done: `bun run check` passes, the new tests pass, no round-1 finding
regressed, and every rule in `AGENTS.md` holds for the changed code. Then update
`AGENTS.md` if any contract shape changed, and delete the stray `tmp-docu-repro.ts`.

---

## P0 — build is broken (must fix first; `tsc -b` currently fails)

1. **`shared/asn1/src/asn1.ts:116-124` — REGRESSION, revert the canonical-bytes gate.**
   The new `decodeRoot` re-encodes the tree and rejects input unless byte-identical.
   `encodeNode` emits definite-length DER + sorted SETs, so **all BER rejected**.
   Real ICP-Brasil `.p12` (Lacuna fixtures) are indefinite-length BER → every
   `parsePkcs12` now fails "Non-canonical DER encoding". Remove lines 116-124 and the
   now-dead `bytesEqual`. **Keep** the trailing-bytes guard (`tlv.next !== data.length`).
   For the original malleability concern: canonicalize on *re-encode* only (already what
   `encode` does), do not gate *decode*.

2. **`core/core/src/http.ts:88` — `Effect.acquireRelease` leaks `Scope`.** Methods now
   return `Effect<A, E, Scope>` but the service declares `never`. Either wrap in
   `Effect.scoped`, or (better, see P1.5) drive the abort from Effect interruption via
   `Effect.tryPromise({ try: (signal) => fetch(url, { signal }) })` and drop
   `acquireRelease` entirely.

3. **`formats/xml/src/config.ts:52` — `Schema.Literal("exclusive","inclusive")` →
   `Schema.Literals([...])`.** `Schema.Literal` takes one arg (AGENTS.md §Schema).
   This collapses the type to `"exclusive"` and cascades to `config.ts:56`, `sign.ts:25`.
   Fixing it makes A5 (inclusive c14n) actually reachable.

4. **`formats/xml/src/verify.ts` — 4 type errors** at `:75` (`X509Certificate(Uint8Array)`
   BufferSource mismatch), `:95` (`string | undefined` → guard `undefined` too),
   `:170` (`matched[0]` is `Element | undefined`), `:285` (narrow `trustedCertificateDer`).

5. **`signers/assinafy/src/index.ts:432` — `resolveAssinafyListNextUrl` is undefined.**
   The whole pagination resolver was never written (and `Option` import is unused).

6. **`signers/docuseal/src/index.ts:373` — `DocuSealSubmissionsResult` type undefined**
   (only singular `DocuSealSubmissionResult` exists).

7. **`signers/clicksign/src/index.ts:135` — `next_page` schema is `string|number|null`
   but `parseClicksignPageNumber` rejects `null`.** Align parser or schema.

---

## P1 — fixes that compile-passed but are functionally wrong

1. **`formats/xml/src/verify.ts:190` — every verification returns `false`.**
   `signedXml.LoadXml(signatureElement).then(() => signedXml.Verify(publicKey))` —
   `LoadXml` returns `void`, so `.then` throws synchronously, caught → `verifyFailed` →
   `catchIf` → `Effect.succeed(false)`. Restore the split: `Effect.try(LoadXml)` then a
   separate `Effect.tryPromise(Verify)`. Without this, A1-A4 are all dead.

2. **`core/core/src/http.ts` — request timeout hangs forever.** `withRequestTimeout`
   interrupts the fetch fiber, but `response.json()`/`arrayBuffer()` are not tied to the
   abort signal, so interruption never completes (its own test times out at 5011ms).
   Pass the interruption signal to `fetch` AND the body reads. Ties into P0.2.

3. **`formats/xml/src/verify.ts` `isTargetAmbiguousOrHidden`** rejects `URI=""` /
   omitted-URI (whole-document enveloped mode) — which is exactly what `signXml` emits
   without a `referenceId`. Documents this package signs can't be verified. Treat the
   canonical whole-doc enveloped reference as valid; keep the XSW guard for `#id` targets.

4. **DocuSeal tests fail (2).** `docuseal.test.ts` dedupe test uses `role: "Signer"`
   (capital) which `RemoteSignatureRecipientRoleSchema` (`Schema.Literals(["approver",
   "signer"])`) rejects before dedupe runs — use lowercase `signer`. The path-encoding
   test asserts `state: "pending"` + no `detailsUrl`; actual is `state: "sent"` +
   `detailsUrl` present — fix the expectation to match real shape. Remove the
   `console.log("create-test:…")` debug lines.

5. **Clicksign atomicity fix is dead code.** `clicksignCreateBoundaryError`
   (`clicksign:466`) is never called, so partial-create failures stay `retryable:true` →
   Alchemy re-`reconcile` duplicates the document. Wire non-retryable classification into
   `createRemoteRequest`, OR (preferred) delete the `*Error` helper (see P2.2) and
   construct the tagged error inline at the failure point.

6. **Assinafy has no atomicity guard at all** (`assinafy:511`) — same duplicate-resource
   hazard, apply the same fix as Clicksign.

7. **`formats/pdf/src/sign.ts:52` — chain retained but not embedded.** `parseCertificate`
   now returns `intermediateCertificates`, but `createDetachedSignedData({...})` omits
   `chainDer` (the field exists at `shared/cms/src/config.ts:157`). Pass the chain so
   ICP-Brasil signatures actually ship the AC chain. (This is the *point* of P1.7.)

8. **Documenso 404 fallback repeats the identical request** (`documenso:478`) — the
   fallback rebuilds the same `/envelope/item/{id}/download` URL that just 404'd; the
   inner `envelopeItems[0].id === undefined` guard is dead. Remove the redundant fallback.

---

## P1b — round-1 findings still UNFIXED (shared/cms was never touched)

9. **`shared/cms/src/timestamp.ts` — TSA response not bound to request.** No nonce sent;
   response `PKIStatus` not checked; token `messageImprint` not compared to the request
   imprint. Add a nonce, verify status == granted, verify imprint match. (MITM replay.)

10. **`shared/cms/src/verify.ts:101` — `chainValid: true` when no roots given.** Report
    `chainValid` honestly (null/undefined or false when `checkChain` is false), never a
    hardcoded `true` for an unverified chain.

11. **`shared/cms/src/verify.ts:74` — revocation never checked.** No CRL/OCSP passed;
    a revoked A1 cert verifies clean. At minimum surface "revocation unchecked" in the
    result rather than implying validity.

12. **`shared/cms/src/attributes.ts:30` — `signingTime` always UTCTime.** Breaks ≥2050
    (2-digit year → 1950). Switch to GeneralizedTime for years ≥2050 per RFC 5652.

13. **`core/core/src/http.ts:242` — `requestVoid` still leaks the connection** (2xx body
    never consumed/cancelled). Drain/cancel `response.body` on the success path.

14. **`core/core/src/http.ts:176` — `parseJsonBody` hardcodes `schemaName:
    providerHttpRequest`.** Thread the real `schemaName`.

15. **`core/core/src/http.ts` — non-idempotent POST still `retryable:true`** (network
    fail + the new timeout error). Classify by method idempotency.

16. **`core/certificates/src/index.ts:244` — `extractCnpj` fallback regex** still grabs
    the first 14-digit run; anchor it to the actual CNPJ OID/field.

---

## P2 — idiomatic cleanup (AGENTS.md)

1. **Lossy string status mappers.** Clicksign `toRemoteSignatureRequestState` (added
    `.includes("closed")`), Assinafy `assinafyRequestState`, ZapSign `zapSignRequestState`
    still use `normalized.includes(...)`. AGENTS.md forbids lossy string helpers — use a
    `switch`/`Match.value(...).pipe(Match.when(...), Match.exhaustive)` over literals like
    Documenso/DocuSeal already do.

2. **Forbidden `*Error` factory helper** `clicksignCreateBoundaryError` — delete it;
    construct the tagged error inline at the decision point (AGENTS.md §Error rules).

3. **Speculative `Record<string, unknown>` pagination probes** — `documensoNextPage`,
    `parseDocuSealSubmissionsNextUrl`, and the Assinafy list union guess dozens of key
    names against untyped `pagination`. Derive a real `Schema` for each provider's actual
    pagination envelope; decode through it (AGENTS.md §Schema is source of truth).

4. **`signers/a1/src/signer.ts:308` `redactPresignedUrl` uses `try/catch`** — forbidden;
    use `Effect.try`/`Schema` or a total parse.

5. **`core/core/src/http.ts:58` `isAbortError` shape-sniffs `.name`** — validate the
    structural shape with `Schema.decodeUnknownEffect` before mapping, or let it be a
    defect (AGENTS.md §Error rules — no hand-rolled cause classifiers).

6. **Cosmetic:** stray double blank line `asn1.ts:440`; test constant
    `XML_EXCLUSIVE_C14N` (`xml.test.ts:14`) holds the *inclusive* URI — rename.

---

## Verified genuinely FIXED (do not touch)
sha512 length ≥512 MiB; hmac long-key zero-pad (`normalizeHmacKey`); OID multi-byte
first arc (`decodeBase128Vlq`); certificate `parseTime` seconds-optional; BMPString DN
decoding (tag-driven); a1 presigned-URL redaction; ZapSign refusal→declined; ZapSign
relative-`next` prefix; Clicksign download-auth host check; Documenso pagination shape.

## Final steps
- `bun run check` green; `bunx vitest run` green (incl. new tests).
- Update `AGENTS.md` only if a contract shape changed.
- `rm tmp-docu-repro.ts`.
