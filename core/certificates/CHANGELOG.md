# Changelog

## 0.2.0

- Retain intermediate CA certificates (`intermediateCertificates`) so signatures can embed
  the full ICP-Brasil chain.
- Decode DirectoryString values by their ASN.1 tag (BMPString → UTF-16BE), fixing garbled
  subjects and CPF/CNPJ extraction on legacy certificates.
- Accept UTCTime without a seconds field; fail typed instead of producing an Invalid Date.
- Anchor CNPJ extraction to the real field rather than the first 14-digit run.

Breaking: `Certificate` gained a required `intermediateCertificates` field.

## 0.1.0

- Initial npm-ready release for `@signature-kit/certificates`.
- Published package metadata, MIT license, README, and package-local changelog.
- Ships pKCS#12 and X.509 certificate parsing APIs for certificate profiles, validity checks, and signer identity extraction.
