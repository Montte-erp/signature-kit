/**
 * CMS signed-attribute builders.
 *
 * Always present: contentType, messageDigest, signingTime, signing-certificate-v2
 * (ESSCertIDv2, RFC 5035). When an ICP-Brasil policy is supplied, the
 * signature-policy-identifier (RFC 5126) is added so the signature is AD-RB/AD-RT
 * shaped. These are pure constructors; the caller lifts them into Effect.try.
 */

import { ESSCertIDv2, SigningCertificateV2 } from "@peculiar/asn1-ess";
import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { type IcpBrasilPolicy, CmsOid, hashAlgorithmOid } from "./config";
import { toArrayBuffer } from "./engine";

const contentTypeAttribute = (): pkijs.Attribute =>
  new pkijs.Attribute({
    type: CmsOid.contentType,
    values: [new asn1js.ObjectIdentifier({ value: CmsOid.data })],
  });

const messageDigestAttribute = (messageDigest: Uint8Array): pkijs.Attribute =>
  new pkijs.Attribute({
    type: CmsOid.messageDigest,
    values: [new asn1js.OctetString({ valueHex: toArrayBuffer(messageDigest) })],
  });

const signingTimeAttribute = (signingTime: Date): pkijs.Attribute =>
  new pkijs.Attribute({
    type: CmsOid.signingTime,
    values: [new asn1js.UTCTime({ valueDate: signingTime })],
  });

/**
 * signing-certificate-v2 (OID …16.2.47). `certHash` MUST be wrapped in the
 * asn1-schema `OctetString`; a raw ArrayBuffer throws "Cannot get schema".
 */
const signingCertificateV2Attribute = (certificateSha256: Uint8Array): pkijs.Attribute => {
  const essCertId = new ESSCertIDv2({
    certHash: new OctetString(toArrayBuffer(certificateSha256)),
  });
  const scv2 = new SigningCertificateV2({ certs: [essCertId] });
  const scv2Der = AsnConvert.serialize(scv2);
  return new pkijs.Attribute({
    type: CmsOid.signingCertificateV2,
    values: [asn1js.fromBER(scv2Der).result],
  });
};

/**
 * signature-policy-identifier (RFC 5126, OID …16.2.15):
 * SignaturePolicyId ::= SEQUENCE { sigPolicyId OID,
 *   sigPolicyHash OtherHashAlgAndValue, sigPolicyQualifiers SEQUENCE OF ... }
 * with a single SPURI qualifier carrying the policy URL.
 */
const SPURI_OID = "1.2.840.113549.1.9.16.5.1";

const signaturePolicyAttribute = (policy: IcpBrasilPolicy): pkijs.Attribute => {
  const otherHashAlgAndValue = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: hashAlgorithmOid(policy.policyHashAlgorithm) }),
        ],
      }),
      new asn1js.OctetString({ valueHex: toArrayBuffer(policy.policyHash) }),
    ],
  });
  const qualifiers = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: SPURI_OID }),
          new asn1js.IA5String({ value: policy.policyUri }),
        ],
      }),
    ],
  });
  const signaturePolicyId = new asn1js.Sequence({
    value: [
      new asn1js.ObjectIdentifier({ value: policy.policyOid }),
      otherHashAlgAndValue,
      qualifiers,
    ],
  });
  return new pkijs.Attribute({
    type: CmsOid.signaturePolicy,
    values: [signaturePolicyId],
  });
};

/**
 * DER SET OF ordering (X.690 §11.6): the SignerInfo `signedAttrs` is a SET OF
 * that MUST be sorted by ascending octet-string comparison of each member's
 * full DER encoding (shorter values padded with trailing 0-octets). pkijs keeps
 * the insertion order verbatim — it signs and encodes the attributes exactly as
 * given — so we must hand them over already sorted. OpenSSL verifies over the
 * bytes as-encoded and is lenient, but BouncyCastle/Java validators (the
 * ICP-Brasil ITI "Verificador de Conformidade" at validar.iti.gov.br)
 * re-canonicalize to DER, which re-sorts the SET OF; an unsorted set then hashes
 * to different bytes and the RSA "cifra assimétrica" check is REPROVADA even
 * though messageDigest and the structure are valid.
 */
const compareDer = (a: Uint8Array, b: Uint8Array): number => {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = index < a.length ? a[index]! : 0;
    const right = index < b.length ? b[index]! : 0;
    if (left !== right) return left - right;
  }
  return 0;
};

const sortAttributesDer = (attributes: readonly pkijs.Attribute[]): readonly pkijs.Attribute[] =>
  [...attributes]
    .map((attribute) => ({ attribute, der: new Uint8Array(attribute.toSchema().toBER()) }))
    .sort((a, b) => compareDer(a.der, b.der))
    .map((entry) => entry.attribute);

export const buildSignedAttributes = (params: {
  readonly messageDigest: Uint8Array;
  readonly signingTime: Date;
  readonly certificateSha256: Uint8Array;
  readonly icpBrasil?: IcpBrasilPolicy | undefined;
}): readonly pkijs.Attribute[] => {
  const attributes = [
    contentTypeAttribute(),
    messageDigestAttribute(params.messageDigest),
    signingTimeAttribute(params.signingTime),
    signingCertificateV2Attribute(params.certificateSha256),
  ];
  if (params.icpBrasil !== undefined) {
    attributes.push(signaturePolicyAttribute(params.icpBrasil));
  }
  return sortAttributesDer(attributes);
};
