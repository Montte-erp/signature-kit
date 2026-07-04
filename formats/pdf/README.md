# @signature-kit/pdf

PDF/PAdES document preparation, visible signature placement, stamping, signing, verification, rubric stamping, merge helpers, and browser text-box extraction.

## Install

```sh
bun add @signature-kit/pdf @signature-kit/signatures @signature-kit/cms effect
```

Add a signer backend at the application boundary, for example:

```sh
bun add @signature-kit/a1
```

`effect` is the runtime peer. The package consumes signing power through `@signature-kit/signatures`.

## Public surface

- `@signature-kit/pdf/config` — PDF schemas, signing/stamping/builder contracts, error catalog, and message catalog.
- `@signature-kit/pdf/sign` — `signPdf` for detached CMS/PAdES signing over a prepared placeholder.
- `@signature-kit/pdf/verify` — `verifyPdf` for ByteRange, CMS, and optional trusted-root chain verification.
- `@signature-kit/pdf/stamp` — badge layout, QR/link stamping, visible-signature stamping, initials/rubric helpers, and coordinate conversion.
- `@signature-kit/pdf/anchors` — `findPdfTextAnchors` for text-anchor placement.
- `@signature-kit/pdf/workflow` — high-level load/template/prepare/sign batch workflows.
- `@signature-kit/pdf/builder` — pure signature-field builder operations.
- `@signature-kit/pdf/builder-store` — external builder store and placement queue helpers.
- `@signature-kit/pdf/byte-range` — placeholder preparation and signature extraction helpers.
- `@signature-kit/pdf/merge` — `mergePdfs`; it copies pages only and intentionally drops source AcroForms, outlines, metadata, and attachments.
- `@signature-kit/pdf/liteparse-browser` — browser-only LiteParse text-box extraction.

Verification coverage semantics: every signature ByteRange must start at byte 0, each signature must cryptographically verify, and the newest signature must cover the file end. Without `trustedRoots`, `verifyPdf` checks coverage and CMS cryptography but does not bind the signer to a trusted chain. Supplying `trustedRoots` makes `chainValid` and the final `valid` verdict require chain validation.

Rubrics never stamp the same page as the full visible signature block. `rubricPageIndexesExcludingSignature(...)` skips the main signature page, and single-page documents receive only the main block.

## Example

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { prepareAndSignPdf } from "@signature-kit/pdf/workflow";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { Effect, Redacted } from "effect";

declare const pdf: Uint8Array;
declare const pfx: Uint8Array;
declare const trustedRoots: Uint8Array[];

const program = Effect.gen(function* () {
  const signed = yield* prepareAndSignPdf({
    pdf,
    badge: {
      header: { text: "Assinado digitalmente" },
      rows: [[{ label: "Documento", value: "Contrato" }]],
      footer: [{ text: "Validar no ITI", link: "https://validar.iti.gov.br/" }],
      qr: { text: "https://validar.iti.gov.br/" },
    },
    signing: {
      policy: "pades-icp-brasil",
      reason: "Assinatura digital",
      name: "Maria Silva",
      location: "BR",
    },
  });

  const verification = yield* verifyPdf({ pdf: signed, trustedRoots });
  return { signed, verification };
}).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") })));
```

## Errors and i18n

PDF failures use the `PdfError` code catalog and `pdfErrorMessages`; CMS and signer failures can also surface from signing workflows. Applications can render localized copy through `@signature-kit/i18n` with the catalogs for every package they call.

Docs: <https://signaturekit.dev/en-US/docs/signing/pdf>.

## License

MIT. See `LICENSE`.
