# SignatureKit

Effect-native digital-signature infrastructure for browser and server runtimes.

SignatureKit is built around one seam: a signer adapter owns where signing power
comes from, while format modules own XML/PDF mutation.

## Current status

- A1 / PKCS#12 certificate loading.
- e-CPF and e-CNPJ identity extraction.
- Backend-agnostic `Signatures` service (`Context.Service` + `Layer`, Effect 4).
- Raw byte signing and verification.
- XML-DSig enveloped signatures via `xmldsigjs`.
- PDF detached CMS signatures via `@cantoo/pdf-lib` + `@signature-kit/cms`.
- PDF-owned browser builder state, placement queues, A1 signing helpers, and PAdES coordinate conversion.
- Browser + server support: WebCrypto-first, no `Buffer` in library internals.
- ICP-Brasil PAdES shape: supported when `policy: "pades-icp-brasil"` is used.
  This embeds `signing-certificate-v2` and `signature-policy-identifier`
  attributes.
- Real ITI Validar smoke: `bun run test:validar-iti` submits a generated PDF to
  `https://validar.iti.gov.br/arquivo`. With the bundled self-signed e-CNPJ
  fixture the official service returns HTTP 406 / “assinaturas desconhecidas”,
  which proves the real endpoint was reached but does not prove ICP-Brasil
  trust-chain acceptance. Full ICP-Brasil compliance still requires running the
  same test with a real ICP-Brasil A1 certificate and expecting HTTP 200.

Compared with `@f-o-t/e-signature@1.9.0`: that package advertises “PAdES PDF
signing with ICP-Brasil compliance” and downloads
`PA_PAdES_AD_RB_v1_1.der`. SignatureKit implements the same policy hook in an
Effect-native service architecture and now has an official endpoint smoke; the
remaining release gate is an HTTP 200 ITI result with a real ICP-Brasil
certificate.

## DX benchmark

- SignatureKit centers usage on one Effect capability seam: `Signatures`
  (`Context.Service` + `Layer`). Apps choose a signer layer once and all byte,
  XML, PDF, and React flows consume that seam.
- PayKit centers provider portability on one configured instance and separate
  provider packages. SignatureKit centers remote providers on Alchemy resources:
  Clicksign, Assinafy, ZapSign, DocuSeal, and Documenso expose retained
  `*SignatureRequest` resource constructors plus `providers(options)` layers over
  `SignatureHttpClient`.
- Deliberate difference: SignatureKit is a cryptographic runtime, not a SaaS
  workflow app. Core does not import XML, PDF, A1, or provider packages; each seam
  stays replaceable.

## Packages

```text
shared/asn1        @signature-kit/asn1                ASN.1 DER decode/encode
shared/crypto      @signature-kit/crypto              PKCS#12, PEM, hashes, cipher primitives
shared/cms         @signature-kit/cms                 CMS/PKCS#7, ICP attrs, RFC 3161 timestamping
core/core          @signature-kit/core                runtime schemas, typed errors, Signatures service
core/certificates  @signature-kit/certificates        Effect-safe PKCS#12/X.509 certificate API
signers/a1         @signature-kit/a1                  A1 / PKCS#12 signer adapter
signers/clicksign  @signature-kit/clicksign           Clicksign remote signer
signers/assinafy   @signature-kit/assinafy            Assinafy remote signer
signers/zapsign    @signature-kit/zapsign             ZapSign remote signer
signers/docuseal   @signature-kit/docuseal            DocuSeal remote signer
signers/documenso  @signature-kit/documenso            Documenso remote signer
formats/xml        @signature-kit/xml                 XML-DSig sign/verify
formats/pdf        @signature-kit/pdf                 PDF detached CMS sign/verify
```

## Usage sketch

### Local signing runtime

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const identity = yield* signatures.inspect();
  const artifact = yield* signatures.sign({
    content,
    algorithm: "rsa-sha256",
  });

  return { identity, artifact };
}).pipe(
  Effect.provide(
    a1SignaturesLayer({
      pfx,
      password: Redacted.make("secret"),
    }),
  ),
);
```

### XML/PDF formats over the same signer

```ts
import { signaturesLayer } from "@signature-kit/core/signatures";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { signXml } from "@signature-kit/xml/sign";
import { xmlRuntimeLayer } from "@signature-kit/xml/runtime";
import { verifyXml } from "@signature-kit/xml/verify";
import { Effect } from "effect";

// Reuse any SignerAdapter, including the A1 signer from the previous example.
const documentProgram = Effect.gen(function* () {
  const layer = signaturesLayer(signer);

  const signedXml = yield* signXml({ xml, referenceId: "doc-1" }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
  const signedPdf = yield* signPdf({
    pdf,
    policy: "pades-icp-brasil",
    reason: "Approval",
    location: "BR",
  }).pipe(Effect.provide(layer));

  const xmlResult = yield* verifyXml({ xml: signedXml, requireReferenceUri: "#doc-1" }).pipe(Effect.provide(xmlRuntimeLayer));
  const pdfResult = yield* verifyPdf({ pdf: signedPdf });

  return { signedXml, signedPdf, xmlResult, pdfResult };
});
```

### Remote provider workflows

```ts
import * as Alchemy from "alchemy";
import { ClicksignSignatureRequest, providers as clicksignProviders } from "@signature-kit/clicksign";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { Effect, Layer, Redacted } from "effect";

export default Alchemy.Stack(
  "Contracts",
  {
    providers: clicksignProviders({
      environment: "sandbox",
      accessToken: Redacted.make("clicksign-token"),
    }).pipe(Layer.provide(signatureHttpClientLive)),
  },
  Effect.gen(function* () {
    return yield* ClicksignSignatureRequest("contract", {
      title: "Contract",
      documents: [{ fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 }],
      recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
    });
  }),
);
```

## Validation

```bash
bun install
bun run check
bun run test
bun run test:validar-iti
```

`bun run test:validar-iti` is intentionally external and hits the real ITI
service. By default it uses the bundled non-ICP fixture and expects HTTP 406 from
Validar. To use a real certificate and assert acceptance:

```bash
SIGNATURE_KIT_ITI_P12_PATH=/path/to/real-a1.p12 \
SIGNATURE_KIT_ITI_P12_PASSWORD=secret \
bun run test:validar-iti
```

Current verification includes:

Tests run on Vitest through `@effect/vitest` (`it.effect`) so Effect workflows
stay in the Effect runtime instead of escaping through ad-hoc `runPromise` calls.

- A1 e-CPF and e-CNPJ sign/verify.
- WebCrypto key cache behavior.
- XML valid and tampered signatures.
- PDF ByteRange/CMS valid and tampered signatures.
- ICP-Brasil policy attribute embedding.
- Browser secure-context smoke for XML and PDF signing.
- Real ITI Validar endpoint smoke with the bundled non-ICP fixture.

Latest local performance smoke: 12 XML+PDF sign/verify iterations averaged
~125 ms per iteration on the current workstation.
