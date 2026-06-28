# SignatureKit Architecture and DX Guide

## Status

Draft steering document for the first public OSS version of `@signature-kit/*`.

SignatureKit is an open-source library suite for digital-signature infrastructure. It should start with **A1 / PKCS#12 certificate support** and grow into a broader signing stack without forcing certificate-specific assumptions into every module.

---

## 1. Purpose

SignatureKit should be the "Better Auth for digital signatures":

- small, composable APIs;
- strong defaults;
- clear package seams;
- signer adapters instead of hard-coded certificate flows;
- first-class TypeScript DX;
- document-format modules separate from signer backends.

The product target is not "just a PFX parser".
It is a signing runtime for:

- certificate-backed signers;
- remote signers;
- byte signing;
- XML digital signatures;
- PDF/CMS signing;
- normalized verification flows;
- provider portability for remote signature workflows.

---

## 2. Product Positioning

### 2.1 What SignatureKit is

SignatureKit is a library suite for teams that need a boring, reusable signing core:

- A1 / PKCS#12 certificate handling;
- digital signatures over bytes;
- XML digital signatures;
- PDF detached CMS signatures;
- signer identity inspection;
- signature verification;
- remote provider workflow integrations.

### 2.2 What SignatureKit is not

SignatureKit is not:

- a document workflow SaaS;
- an e-signature UI product;
- a PDF editor;
- a government protocol client by default;
- a certificate authority;
- a secrets vault.

SignatureKit should stay runtime-first and integration-friendly.

---

## 3. Core Design Principles

### 3.1 Better Auth-like DX

SignatureKit should copy the good parts of Better Auth:

- one small root runtime;
- boring and memorable names;
- adapters for signer backends;
- separate modules for document formats;
- first-class client ergonomics where useful;
- optional integrations without making core depend on them.

Benchmark against current docs:

- Better Auth's installation flow creates one exported `auth = betterAuth({ ... })`
  instance. SignatureKit uses the Effect-native equivalent: a signer `Layer` that
  provides the `Signatures` service, not a root facade object.
- Better Auth keeps databases and ORMs behind adapters. SignatureKit should keep A1,
  future HSM/government signers, XML, PDF, and remote workflow vendors behind
  adapters or format modules.
- PayKit's setup creates one `createPayKit({ ... })` server instance and provider
  portability comes from provider-specific packages. SignatureKit keeps Clicksign,
  Assinafy, ZapSign, DocuSeal, and Documenso as direct remote signer packages
  instead of adding a provider-neutral gateway.
- PayKit exposes handlers and clients because billing has a server/client product
  surface. SignatureKit should not add a handler/client abstraction until a real
  request/response signing product surface exists; cryptographic signing remains a
  runtime library seam.

### 3.2 Boring names win

Every public name should be guessable before reading docs.

Good:

- `signaturesLayer`
- `a1SignaturesLayer`
- `createGovBrSignerAdapter`
- `signatures.sign`
- `certificates.inspect`
- `xml.sign`

Bad:

- `createTrustKernel`
- `createCryptoOrchestrator`
- `attachSigningCapability`
- `identityProofEngine`

### 3.3 Result and error discipline

Every SignatureKit package should follow one explicit discipline:

- expected recoverable failures use typed Effect errors;
- mandatory invariants hard-fail as Effect defects or schema decode failures;
- contracts are `Schema`-first and types are derived from schemas;
- services use Effect v4 `Context.Service` + `Layer`.

That means:

- no public API returning raw `Error` or `string` failures;
- no signer adapter inventing a parallel error model;
- no format module bypassing the core result discipline.

### 3.4 Real seams, not hypothetical seams

Separate only seams that already exist in the product:

1. signing runtime;
2. signer backend adapter;
3. certificate container support;
4. signature format module;
5. external integration.

### 3.5 Signer backend is not document format

SignatureKit must not couple "where the signing capability comes from" with "what is being signed".

Examples:

- A1 / PKCS#12 is a signer backend;
- remote government signing is a signer backend;
- XMLDSig is a signature format module;
- PDF signing is a signature format module.

This separation is mandatory for long-term flexibility.

### 3.6 Shared infrastructure is internal-only

A shared internal layer is reasonable, but it must stay small and unpublished.

Use it for:

- ASN.1 / PKCS#12 parsing helpers reused by multiple packages;
- XML canonicalization helpers;
- digest and signature algorithm helpers;
- test fixtures and golden snapshots;
- internal build/config reuse when it actually removes repetition.

Do not publish shared packages to npm.
They are workspace-only implementation details.

---

## 4. Naming and Repo Topology

## 4.1 Top-level workspace groups

Use these physical repo groups:

- `apps/`
- `core/`
- `signers/`
- `formats/`
- `shared/`
- `tooling/`

These are grouping directories, not publishable packages themselves.
Every publishable package lives one level below them and owns its own `package.json`.

## 4.2 Package map

### Publishable packages

#### `core/`

- `core/core` → `@signature-kit/core`
- `core/certificates` → `@signature-kit/certificates`

#### `signers/`

- `signers/a1` → `@signature-kit/a1`
- `signers/clicksign` → `@signature-kit/clicksign`
- `signers/assinafy` → `@signature-kit/assinafy`
- `signers/zapsign` → `@signature-kit/zapsign`
- `signers/docuseal` → `@signature-kit/docuseal`
- `signers/documenso` → `@signature-kit/documenso`

#### `formats/`

- `formats/xml` → `@signature-kit/xml`
- `formats/pdf` → `@signature-kit/pdf`

#### `tooling/`

- `tooling/static-checks` → architecture and Effect-native policy checks
  for this monorepo

#### `shared/`

- `shared/asn1` → internal ASN.1 DER decode/encode
- `shared/crypto` → internal PKCS#12, PEM, hashing, cipher primitives
- `shared/cms` → internal CMS/PKCS#7 and RFC 3161 timestamping

---

## 5. Package Responsibilities

### 5.1 `@signature-kit/core`

Purpose:

- own public runtime schemas, typed `SignatureKitError`, and signer contracts;
- expose the `Signatures` service and `signaturesLayer` seam;
- keep every package on the same `SignatureKitError` catalog;
- expose remote signer request DTOs and the `SignatureHttpClient` seam without a
  separate contracts-only package.

Must not depend on:

- PKCS#12 parsing implementation details;
- XML implementation details;
- government-specific SDKs;
- UI frameworks.

### 5.2 `@signature-kit/certificates`

Purpose:

- parse PKCS#12/PFX sources and X.509 DER;
- normalize certificate identity fields, including ICP-Brasil CPF/CNPJ data;
- keep certificate parsing out of the runtime facade.


### 5.3 `@signature-kit/a1`

Purpose:

- load `.pfx` / `.p12` containers through `@signature-kit/certificates`;
- validate password;
- extract certificate and private-key material internally;
- implement the signer adapter contract using A1 certificates.

This package is the first real backend, not the whole product.

### 5.4 Remote signer packages

Purpose:

- one package per provider: Clicksign, Assinafy, ZapSign, DocuSeal, and
  Documenso;
- expose direct `create*SignatureRequest(...)` functions over `SignatureHttpClient`;
- keep provider HTTP protocol details inside that provider adapter;
- let users install only the providers they use.

### 5.5 Alchemy provider pattern

Alchemy v2 is used inside signer packages, not as a separate integration package:

- signer packages declare resource constructors with `Resource<T>(type)`;
- resource providers use `Provider.effect(...)`;
- each signer package may expose a `providers(options)` layer;
- state-store-safe props stay at the Alchemy boundary and decode into runtime inputs.

### 5.6 `@signature-kit/xml`

Purpose:

- implement XML digital signature behavior;
- keep canonicalization, transforms, digesting, and insertion logic separate from signer backends;
- accept any signer adapter compatible with the core contract.

### 5.7 future government signer packages

Only add this package when a real remote-government signer seam exists.

Its role is not generic signing logic. Its role is backend-specific protocol, auth, request/response normalization, polling, and capability bridging into the signer contract.

---

## 6. Public API Shape

### 6.1 Runtime surface

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const certificate = yield* signatures.inspect();
  const signed = yield* signatures.sign({
    content: payloadBytes,
    algorithm: "rsa-sha256",
  });

  return { certificate, signed };
}).pipe(
  Effect.provide(
    a1SignaturesLayer({
      pfx: certificateBytes,
      password: Redacted.make("secret"),
    }),
  ),
);
```

### 6.2 Stable namespaces

The core exposes service accessors:

- `signatures.inspect()`
- `signatures.sign()`
- `signatures.verify()`
- XML/PDF packages consume `Signatures` through `Effect.provide(layer)`.

### 6.3 Current runtime options

```ts
const layer = a1SignaturesLayer({
  pfx: certificateBytes,
  password: Redacted.make("secret"),
});
```

---

## 7. Core Contracts

### 7.1 Signer adapter

```ts
type SignerAdapter = {
  id: string;
  inspect(): Effect.Effect<SignerIdentity, SignatureKitError>;
  certificate(): Effect.Effect<Certificate, SignatureKitError>;
  importSigningKey(algorithm: SignatureAlgorithm): Effect.Effect<CryptoKey, SignatureKitError>;
  sign(input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError>;
  verify(input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError>;
};
```

The adapter owns the signing capability.
It must not own XML-specific document mutation.

### 7.2 Identity model

```ts
type SignerIdentity = {
  subject: string;
  issuer: string;
  serialNumber: string;
  thumbprint: string;
  validFrom: Date;
  validTo: Date;
  document?: string;
};
```

### 7.3 Core signing inputs

```ts
type SignatureAlgorithm = "rsa-sha1" | "rsa-sha256" | "rsa-sha512";

type SignInput = {
  content: Uint8Array;
  algorithm: SignatureAlgorithm;
};

type VerifyInput = {
  content: Uint8Array;
  signature: Uint8Array;
  algorithm: SignatureAlgorithm;
};
```

### 7.4 XML module contract

```ts
type XmlSignatureModule = {
  sign(input: XmlSignInput): Effect.Effect<string, XmlError | SignatureKitError, Signatures>;
  verify(input: XmlVerifyInput): Effect.Effect<XmlVerificationResult, XmlError>;
};
```

---

## 8. Implemented Scope

### 8.1 What is in the first working cut

- `@signature-kit/core` and `@signature-kit/certificates`;
- `@signature-kit/a1` for PKCS#12 / PFX loading, password validation, e-CPF/e-CNPJ
  identity extraction, byte signing, and byte verification;
- `@signature-kit/clicksign`, `@signature-kit/assinafy`, `@signature-kit/zapsign`,
  `@signature-kit/docuseal`, and `@signature-kit/documenso` for remote
  signature-request workflows;
- `@signature-kit/xml` for XMLDSig sign/verify over the `Signatures` seam;
- `@signature-kit/pdf` and internal `@signature-kit/cms` for detached CMS / PAdES-shaped
  PDF signing;
- focused `@effect/vitest` tests with fixtures, tamper checks, browser smoke, and
  real ITI Validar endpoint smoke.

### 8.2 Still out of scope

- A3 certificates;
- token / smartcard / HSM support;
- OCSP / CRL online validation;
- workflow UI, inboxes, routing, approval screens, and provider dashboards.

---

## 9. A1-First Strategy

A1 is the first delivery vehicle, not the architecture.

That means:

- A1 should be the first adapter package;
- the core runtime should never mention PFX in its public contract;
- byte signing should remain format-agnostic;
- XML signing should consume the signer contract instead of reaching into A1 internals.

If this rule is respected, SignatureKit can later support:

- remote government signers;
- cloud-signature APIs;
- HSM-backed signers;
- non-certificate signing providers where the contract still fits.

---

## 10. Future Government Adapter Shape

A future government-facing package may fit one of two roles:

### 10.1 Government as signer backend

If the government platform itself provides remote signing capability, model it as a signer adapter:

```ts
const layer = govBrSignaturesLayer({
  credential: "...",
});
```

### 10.2 Government as delivery integration

If SignatureKit signs locally and the government endpoint only receives the signed artifact, keep that package outside the signer abstraction.

Example:

```ts
const signedXml = yield* signXml({ ... }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
yield* govBrClient.submit(signedXml);
```

This distinction prevents the core from collapsing backend concerns and transport concerns into one API.

---

## 11. Open-Source Positioning

SignatureKit should be OSS.

Recommended posture:

- MIT or Apache-2.0 at the repo root;
- public adapters and format modules published under `@signature-kit/*`;
- internal `shared/*` packages private and unpublished;
- no open-core split in the initial architecture.

The value should come from:

- DX;
- portability;
- composability;
- strong contracts;
- maintainable integration surfaces.

---

## 12. Current File Layout

```txt
core/
  core/         # runtime schemas, errors, Signatures service
  certificates/ # PKCS#12/X.509 parse + identity normalization
signers/
  a1/           # PKCS#12 signer adapter
  clicksign/    # remote signer adapter
  assinafy/
  zapsign/
  docuseal/
  documenso/
formats/
  xml/         # XMLDSig document mutation
  pdf/         # PDF mutation + detached CMS embedding
shared/
  asn1/        # internal ASN.1 primitives
  crypto/      # internal PKCS#12 / PEM / hash primitives
  cms/         # internal CMS / PKCS#7 primitives
```

---

## 13. API Naming Rules

Use simple, stable names:

- signing seam: `signaturesLayer`
- first adapter layer: `a1SignaturesLayer`
- future adapter layer: `govBrSignaturesLayer`
- certificate API: `certificates.inspect`
- bytes API: `signatures.sign`, `signatures.verify`
- remote signer API: `createClicksignSignatureRequest`,
  `createAssinafySignatureRequest`, `createZapSignSignatureRequest`,
  `createDocuSealSignatureRequest`, `createDocumensoSignatureRequest`

Do not introduce synonyms for the same concept. Use `signer` for signing
capability backends; use `provider` only for remote workflow vendors such as
Clicksign, Assinafy, ZapSign, DocuSeal, and Documenso.

---

## 14. Decision Summary

SignatureKit now has:

1. one lean signer runtime in `@signature-kit/core`;
2. one real local backend in `@signature-kit/a1`;
3. XML and PDF format modules that consume the same signing seam;
4. direct remote signer packages for Clicksign, Assinafy, ZapSign, DocuSeal, and Documenso;
5. OSS packaging and boring names.

The architecture succeeds if A1 is only the first backend, not the product definition.
