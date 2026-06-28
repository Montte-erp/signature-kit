# SignatureKit — agnostic signing runtime plan

Status: IMPLEMENTED (A1 + XML + PDF round trips). SignatureKit owns certificate
loading and backend-agnostic signing power; XML/PDF packages own document mutation
and call the same `Signatures` service.

## Decisions (locked)

1. Scope this round: **core Signatures service + A1 + XML-DSig + PDF detached CMS**.
2. A1 supports both **e-CPF** and **e-CNPJ** certificates by extracting the
   Brazilian document metadata from X.509 subject / SAN fields.
3. Public signing power stays document-format agnostic. XML/PDF adapters prepare
   format-specific bytes and consume the same core `Signatures` service.
4. Browser and server compatibility means WebCrypto-first code: no Node-only
   crypto surface in library internals.
5. Effect-native discipline is mandatory: `Context.Service` + `Layer`, typed
   Effect errors, `Redacted` secrets, no hidden `Effect.provide`, no throws.

## Integrated format stack

| Adapter | Packages |
|---|---|
| CMS/PKCS#7 | `pkijs@3.4.0`, `asn1js@3.0.10`, `@peculiar/asn1-schema@2.8.0`, `@peculiar/asn1-cms@2.8.0`, `@peculiar/asn1-x509@2.8.0`, `@peculiar/asn1-ess@2.8.0` |
| XML-DSig | `xmldsigjs@2.8.7`, `xml-core@^1.2.5`, `@xmldom/xmldom@^0.9`, `reflect-metadata@^0.2.2`; `xml-crypto@6.1.2` remains a dev oracle |
| PDF / PAdES-style detached CMS | `@cantoo/pdf-lib@2.7.1` for browser-safe PDF mutation + `@signature-kit/cms` for CMS bytes |

## Current package APIs

### `@signature-kit/core`

- `SignatureKitError`, signature schemas, `SignerAdapter`, and remote signer request DTOs live in `@signature-kit/core/config`.
- `SignatureHttpClient` lives in `@signature-kit/core/http`.
- `signaturesLayer(signer) → Layer<Signatures>`
- `signatures.inspect/sign/verify` require the `Signatures` service and stay
  backend-agnostic.

`@signature-kit/core` is the shared contract surface plus the `Signatures` service;
there is no root runtime facade and no separate contracts-only package.

### `@signature-kit/certificates`

- `parseCertificate(source, password) → Effect<Certificate, SignatureKitError>`
- `toSignerIdentity(certificate) → SignerIdentity`

### `@signature-kit/a1`

- `createA1SignerAdapter(certificate) → SignerAdapter`
- `loadA1SignerAdapter({ pfx, password }) → Effect<SignerAdapter, SignatureKitError>`
- `a1SignaturesLayer({ pfx, password }) → Layer<Signatures, SignatureKitError>`

### Remote signer packages

- `@signature-kit/clicksign`, `@signature-kit/assinafy`,
  `@signature-kit/zapsign`, `@signature-kit/docuseal`, and `@signature-kit/documenso`
  each own one remote signing protocol adapter.
- Remote signers expose direct `create*SignatureRequest(...)` functions over the
  `SignatureHttpClient` service; there is no provider-neutral gateway package.

### `@signature-kit/xml`

- `signXml({ xml, referenceId?, algorithm? }) → Effect<string, XmlError | SignatureKitError, Signatures>`
- `verifyXml({ xml, publicKeyDer?, requireReferenceUri? }) → Effect<XmlVerificationResult, XmlError>`

### `@signature-kit/pdf`

- `signPdf({ pdf, reason?, location?, appearance? }) → Effect<Uint8Array, PdfError | CmsError | SignatureKitError, Signatures>`
- `verifyPdf({ pdf, trustedRoots? }) → Effect<PdfVerificationResult, PdfError | CmsError>`

## Format-adapter contract

- PDF/XML adapters do not parse A1 containers or unwrap secrets themselves.
- They consume a provided `Signatures` service, prepare the bytes to sign, and
  embed the returned signature using browser-safe libraries.
- `node-forge` and Node `Buffer` stay out of browser/server library internals.
