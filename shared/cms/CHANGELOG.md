# Changelog

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
- Ships cMS/PKCS#7 signing and verification helpers, including ICP-Brasil policy support and timestamp request contracts.
