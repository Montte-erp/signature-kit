## @signature-kit/cms@0.2.2

### Native byte conversion and verified release gates

Use native Uint8Array copies at ASN.1 and WebCrypto boundaries, removing redundant buffer adapters while preserving byte offsets and detached-signature verification. Add coverage for sliced buffers and tampered content.

The workspace now discovers every browser test, isolates live provider suites from local runs, and requires the complete CI validation workflow before publishing.

# Changelog

## 0.2.1

- Export English and pt-BR `cmsErrorMessages` catalogs for code-keyed display
  copy.
- Ship complete ICP-Brasil PA_PAdES_AD_RB_v1_1 policy metadata, including the
  pinned SHA-256 policy hash, so consumers no longer assemble AD-RB policy
  constants by hand.

- Validate ICP-Brasil PAdES policy fetch options before applying the timeout, and
  compute the content digest and certificate digest concurrently during CMS
  signing.
- PAdES CMS output no longer emits the prohibited CMS `signingTime` signed
  attribute (OID 1.2.840.113549.1.9.5); ITI Validar
  (PA_PAdES_AD_RB_v1_1) now approves generated signatures. Signing time remains
  in the PDF dictionary `/M` entry.

## 0.2.0

- Bind RFC 3161 timestamp responses to the request: send a nonce, require PKIStatus
  `granted`/`grantedWithMods`, and verify the returned `messageImprint` matches the request.
- Report `chainValid` honestly — it is no longer `true` when no trusted roots are supplied.
- Add `revocationStatus` (`checked`/`not_checked`) to the verification result.
- Encode `signingTime` as GeneralizedTime for years ≥ 2050 (UTCTime for 1950–2049).

Breaking: `CmsVerifyResult` gained `revocationStatus`, and `chainValid` no longer defaults
to `true` for unverified chains.

## 0.1.0

- Initial npm-ready release for `@signature-kit/cms`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships CMS/PKCS#7 signing and verification helpers, including ICP-Brasil policy support and timestamp request contracts.
