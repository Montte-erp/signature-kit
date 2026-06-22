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

- Better Auth centers usage on one exported instance (`betterAuth({ ... })`) with
  adapters around it. SignatureKit mirrors that with `createSignatureKit({ signer })`,
  while keeping Effect `Context.Service` / `Layer` APIs available for libraries.
- PayKit centers provider portability on one configured instance and separate
  provider packages. SignatureKit mirrors that with
  `createSignatureGateway({ providers: [docusign(...), dropboxSign(...)] })`;
  there is no monolithic `signature-providers` package.
- Deliberate difference: SignatureKit is a cryptographic runtime, not a SaaS
  workflow app. Core does not import XML, PDF, A1, or provider packages; each seam
  stays replaceable.

## Packages

```text
shared/asn1        @signature-kit/asn1                ASN.1 DER decode/encode
shared/crypto      @signature-kit/crypto              PKCS#12, PEM, hashes, cipher primitives
shared/cms         @signature-kit/cms                 CMS/PKCS#7, ICP attrs, RFC 3161 timestamping
core/config        @signature-kit/config              shared schemas, typed errors, signer contracts
core/x509          @signature-kit/x509                X.509 parsing and identity normalization
core/core          @signature-kit/core                Signatures service + createSignatureKit runtime
signers/a1         @signature-kit/a1                  A1 / PKCS#12 signer adapter
signers/gateway    @signature-kit/signature-gateway   provider-neutral signature workflow gateway
signers/docusign   @signature-kit/docusign            DocuSign provider adapter
signers/dropbox-sign @signature-kit/dropbox-sign      Dropbox Sign provider adapter
signers/adobe-sign @signature-kit/adobe-sign          Adobe Acrobat Sign provider adapter
signers/clicksign  @signature-kit/clicksign           Clicksign provider adapter
formats/xml        @signature-kit/xml                 XML-DSig sign/verify
formats/pdf        @signature-kit/pdf                 PDF detached CMS sign/verify
```

## Usage sketch

### Local signing runtime

```ts
import { createSignatureKit } from "@signature-kit/core";
import { loadA1SignerAdapter } from "@signature-kit/a1";
import { Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const signer = yield* loadA1SignerAdapter({
    pfx,
    password: Redacted.make("secret"),
  });
  const signatureKit = createSignatureKit({ signer });

  const identity = yield* signatureKit.certificates.inspect();
  const artifact = yield* signatureKit.signatures.sign({
    content,
    algorithm: "rsa-sha256",
  });

  return { identity, artifact };
});
```

### XML/PDF formats over the same signer

```ts
import { signaturesLayer } from "@signature-kit/core";
import { signPdf, verifyPdf } from "@signature-kit/pdf";
import { signXml, verifyXml } from "@signature-kit/xml";
import { Effect } from "effect";

// Reuse any SignerAdapter, including the A1 signer from the previous example.
const documentProgram = Effect.gen(function* () {
  const layer = signaturesLayer(signer);

  const signedXml = yield* signXml({ xml, referenceId: "doc-1" }).pipe(Effect.provide(layer));
  const signedPdf = yield* signPdf({
    pdf,
    policy: "pades-icp-brasil",
    reason: "Approval",
    location: "BR",
  }).pipe(Effect.provide(layer));

  const xmlResult = yield* verifyXml({ xml: signedXml, requireReferenceUri: "#doc-1" });
  const pdfResult = yield* verifyPdf({ pdf: signedPdf });

  return { signedXml, signedPdf, xmlResult, pdfResult };
});
```

### Remote provider workflows

```ts
import { createSignatureGateway } from "@signature-kit/signature-gateway";
import { docusign } from "@signature-kit/docusign";
import { dropboxSign } from "@signature-kit/dropbox-sign";
import { Redacted } from "effect";

const gateway = createSignatureGateway({
  providers: [
    docusign({
      baseUrl: "https://demo.docusign.net/restapi",
      accountId: "account-123",
      accessToken: Redacted.make("docusign-token"),
    }),
    dropboxSign({
      apiKey: Redacted.make("dropbox-key"),
      testMode: true,
    }),
  ],
});

const request = gateway.createSignatureRequest({
  provider: "docusign",
  title: "Contract",
  documents: [document],
  recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
});
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
