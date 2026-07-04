# SignatureKit

Effect-native digital-signature infrastructure for TypeScript runtimes.

SignatureKit separates signing power from document mutation: signer adapters expose one typed `Signatures` service, while format packages own PDF/PAdES and XML-DSig bytes. A1 / PKCS#12 is the first local backend; remote SaaS providers are modeled as retained Alchemy resources, not as local key holders.

## Package map

```text
core/signatures     @signature-kit/signatures    Runtime schemas, typed errors, Signatures service
core/http           @signature-kit/http          HTTP client service, retries, response decoding, redacted diagnostics
core/certificates   @signature-kit/certificates  PKCS#12 and X.509 parsing plus signer identity helpers
core/i18n           @signature-kit/i18n          Code-keyed localized error-message resolution

shared/asn1         @signature-kit/asn1          Pure ASN.1 DER decode/encode and typed accessors
shared/crypto       @signature-kit/crypto        Base64, PEM, PKCS#12, hashing, and cipher primitives
shared/cms          @signature-kit/cms           CMS/PKCS#7 detached signatures, ICP-Brasil policy attrs, RFC 3161

formats/pdf         @signature-kit/pdf           PDF/PAdES signing, verification, badges, anchors, rubrics, workflows
formats/xml         @signature-kit/xml           XML-DSig signing and verification over an explicit XmlRuntime
formats/react       @signature-kit/react         Headless browser A1 signing hooks

signers/a1          @signature-kit/a1            Local A1 / PKCS#12 signer adapter
signers/assinafy    @signature-kit/assinafy      Assinafy retained remote-signature request resource
signers/clicksign   @signature-kit/clicksign     Clicksign retained remote-signature request resource
signers/documenso   @signature-kit/documenso     Documenso retained envelope resource
signers/docuseal    @signature-kit/docuseal      DocuSeal retained submission resource
signers/zapsign     @signature-kit/zapsign       ZapSign retained single-PDF document resource

validators/iti      @signature-kit/iti           Local ITI conformance pre-check and Validar remote client
```

See the package READMEs for the exact export maps. Several packages are subpath-only; examples below use only paths present in each `package.json` `exports` map.

## Quick start: A1 + PDF + ICP-Brasil + ITI

```sh
bun add @signature-kit/a1 @signature-kit/pdf @signature-kit/iti @signature-kit/http effect
```

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatureHttpClientLive } from "@signature-kit/http";
import { validatePdfConformance } from "@signature-kit/iti/conformance";
import { validatePdfWithIti } from "@signature-kit/iti/remote";
import { prepareAndSignPdf } from "@signature-kit/pdf/workflow";
import { Effect, Redacted } from "effect";

declare const pdf: Uint8Array;
declare const pfx: Uint8Array;
declare const trustedRoots: Uint8Array[];

const result = await Effect.runPromise(
  Effect.gen(function* () {
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

    const localConformance = yield* validatePdfConformance({ pdf: signed, trustedRoots });
    const remoteValidation = yield* validatePdfWithIti({
      source: { pdf: signed },
      fileName: "signed.pdf",
    });

    return { signed, localConformance, remoteValidation };
  }).pipe(
    Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") })),
    Effect.provide(signatureHttpClientLive),
  ),
);
```

`policy: "pades-icp-brasil"` uses the pinned ICP-Brasil PA_PAdES_AD_RB_v1_1 policy metadata from `@signature-kit/cms`. Generated AD-RB PAdES signatures are accepted by `validar.iti.gov.br` when the signing certificate chains to a trusted ICP-Brasil root. The local `@signature-kit/iti` conformance pre-check verifies the same structural requirements before a remote submission: ByteRange coverage, CMS cryptography, AD-RB policy OID, `signing-certificate-v2`, and the AD-RB prohibition on CMS `signingTime`. The remote client models the official 406 untrusted-certificate response as a typed `untrusted_certificate` report, not as a transport failure.

## React and shadcn

`@signature-kit/react` is hooks-only: `useA1Certificate`, `useA1Signer`, external-store helpers, and browser PDF object URLs. UI components moved to the docs-hosted shadcn registry so apps own their chrome:

```sh
npx shadcn@latest add https://signaturekit.dev/r/signature-dialog.json
```

More registry items are listed in the React components recipe.

## Documentation

- Docs site: <https://signaturekit.dev/en-US/docs>
- Quick start: <https://signaturekit.dev/en-US/docs/get-started/quickstart>
- A1 browser PDF flow: <https://signaturekit.dev/en-US/docs/a1-signing/browser-pdf-flow>
- PDF signing: <https://signaturekit.dev/en-US/docs/signing/pdf>
- XML signing: <https://signaturekit.dev/en-US/docs/signing/xml>
- Remote providers: <https://signaturekit.dev/en-US/docs/concepts/remote-signature-requests>
- Error handling: <https://signaturekit.dev/en-US/docs/signing/errors>

## Package READMEs

- [`core/signatures`](core/signatures/README.md)
- [`core/http`](core/http/README.md)
- [`core/certificates`](core/certificates/README.md)
- [`core/i18n`](core/i18n/README.md)
- [`shared/asn1`](shared/asn1/README.md)
- [`shared/crypto`](shared/crypto/README.md)
- [`shared/cms`](shared/cms/README.md)
- [`formats/pdf`](formats/pdf/README.md)
- [`formats/xml`](formats/xml/README.md)
- [`formats/react`](formats/react/README.md)
- [`signers/a1`](signers/a1/README.md)
- [`signers/assinafy`](signers/assinafy/README.md)
- [`signers/clicksign`](signers/clicksign/README.md)
- [`signers/documenso`](signers/documenso/README.md)
- [`signers/docuseal`](signers/docuseal/README.md)
- [`signers/zapsign`](signers/zapsign/README.md)
- [`validators/iti`](validators/iti/README.md)

## Validation

```sh
bun run build && bun run check && bun run test
```

`bun run test:validar-iti` submits committed fixtures to the real Validar endpoint when `SIGNATURE_KIT_ITI_VALIDATE=1` is set.

## License

MIT. See [`LICENSE`](LICENSE).
