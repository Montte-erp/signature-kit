# @signature-kit/iti

ITI/PAdES conformance and remote Validar client for PDFs signed with the ICP-Brasil AD-RB profile.

## Install

```sh
bun add @signature-kit/iti @signature-kit/http @signature-kit/pdf effect
```

`effect` is the runtime peer. Provide `signatureHttpClientLive` only when calling the remote Validar client.

## Public surface

- `@signature-kit/iti/conformance` — `validatePdfConformance` plus check/report schemas for local PAdES AD-RB structure validation.
- `@signature-kit/iti/remote` — `validatePdfWithIti` plus source and remote report schemas for `https://validar.iti.gov.br/arquivo`.

Local conformance checks ByteRange coverage, PDF verification, signer attributes, AD-RB policy OID, `signing-certificate-v2`, and the AD-RB rule that CMS `signingTime` must be absent. Remote validation submits the PDF to the official ITI Validar endpoint and combines the local report with the remote verdict.

The official endpoint can return HTTP 406 for a structurally valid signature whose certificate is not trusted by ITI. This package models that as an `untrusted_certificate` validation report with `approved: false`, not as a transport failure.

## Example

```ts
import { signatureHttpClientLive } from "@signature-kit/http";
import { validatePdfConformance } from "@signature-kit/iti/conformance";
import { validatePdfWithIti } from "@signature-kit/iti/remote";
import { Effect } from "effect";

declare const signedPdf: Uint8Array;
declare const trustedRoots: Uint8Array[];

const program = Effect.gen(function* () {
  const local = yield* validatePdfConformance({
    pdf: signedPdf,
    trustedRoots,
  });

  const remote = yield* validatePdfWithIti({
    source: { pdf: signedPdf },
    fileName: "signed.pdf",
  });

  return { local, remote };
}).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

ITI validation reports are values; malformed inputs, HTTP failures outside the documented verdict shape, and schema failures use `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`, `pdfErrorMessages`, and `cmsErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/signing/iti>.

## License

MIT. See `LICENSE`.
