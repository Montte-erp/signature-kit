# @signature-kit/cms

CMS/PKCS#7 detached signing and verification helpers, ICP-Brasil PAdES policy metadata, inspection utilities, and RFC 3161 timestamp request contracts.

## Install

```sh
bun add @signature-kit/cms effect
```

`effect` is a direct runtime dependency. This is a low-level support package; PDF signing normally goes through `@signature-kit/pdf`.

## Public surface

- `@signature-kit/cms/config` — `CmsError`, `CmsErrorCodeValue`, `CmsOperationValue`, `CmsHashAlgorithmValue`, `CmsVerifyResultSchema`, `TimestampOptionsSchema`, policy schemas, and `cmsErrorMessages`.
- `@signature-kit/cms/icp-brasil` — `IcpBrasilPadesPolicy`, `parseIcpBrasilPadesPolicy`, and `fetchIcpBrasilPadesPolicy`.
- `@signature-kit/cms/inspect` — `inspectDetachedSignedData` plus signed-attribute and inspection schemas.
- `@signature-kit/cms/sign` — `createDetachedSignedData`.
- `@signature-kit/cms/verify` — `verifyDetachedSignedData`.

RFC 3161 signing requires `timestamp.trustedRoots`: a non-empty list of DER-encoded TSA
trust anchors. Timestamp tokens are accepted only when their CMS signature and certificate
chain verify against those anchors, the TSA certificate has a critical timestamping-only EKU
(and signing-capable KeyUsage when present), and its required signed attributes bind the signer
certificate. SignatureKit does not use an ambient or system trust store.

`IcpBrasilPadesPolicy.adRbV11` is the pinned PA_PAdES_AD_RB_v1_1 policy:

- OID: `2.16.76.1.7.1.11.1.1`
- Hash algorithm: `sha256`
- Policy hash: `44fc5816eb2d705d8c8f022a7f93b3fb49edfae1a7b9149ef6fab833e9bb63f8`
- URI: `http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der`

`fetchIcpBrasilPadesPolicy` accepts a downloaded policy only when its encoded hash algorithm
and hash exactly match this pin.

PAdES AD-RB signatures must not include CMS `signingTime`; the PDF dictionary owns signing time. `@signature-kit/iti` rejects generated signatures that include the prohibited attribute.

## Example

```ts
import { IcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { inspectDetachedSignedData } from "@signature-kit/cms/inspect";
import { Effect } from "effect";

declare const cms: Uint8Array;

const program = Effect.gen(function* () {
  const inspection = yield* inspectDetachedSignedData({ cms });

  return {
    policyOid: IcpBrasilPadesPolicy.adRbV11.policyOid,
    signerCommonName: inspection.signerCommonName,
    signedAttributes: inspection.signedAttributes.length,
  };
});
```

## Errors and i18n

CMS failures use the `CmsError` code catalog and `cmsErrorMessages`. Applications can render localized copy through `@signature-kit/i18n` by passing that catalog to `errorMessage`.

Docs: <https://signaturekit.dev/en-US/docs/signing/pdf>.

## License

MIT. See `LICENSE`.
