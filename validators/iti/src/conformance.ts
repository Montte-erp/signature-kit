import { IssuerSerial } from "@peculiar/asn1-ess";
import { AsnConvert } from "@peculiar/asn1-schema";
import { CmsOid } from "@signature-kit/cms/config";
import { IcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { inspectDetachedSignedData } from "@signature-kit/cms/inspect";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import {
  extractPdfSignatures,
  hasPdfSignatureDictionary,
  isCompletePdfRevision,
} from "@signature-kit/pdf/byte-range";
import { PdfErrorCodeValue } from "@signature-kit/pdf/config";
import { loadPdfSignatureDocument } from "@signature-kit/pdf/workflow";
import * as asn1js from "asn1js";
import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";

const ITI_PROVIDER = "iti";
export const ItiOperation = {
  conformance: "iti.conformance",
  remote: "iti.remote",
} satisfies Record<string, string>;
const ITI_PADES_AD_RB_POLICY_OID = IcpBrasilPadesPolicy.adRbV11.policyOid;
const ITI_PADES_AD_RB_SIGNATURE_TYPE = "PA_PAdES_AD_RB_v1_1";

export const ItiConformanceOutcomeSchema = Schema.Literals(["approved", "rejected"]);
export type ItiConformanceOutcome = (typeof ItiConformanceOutcomeSchema)["Type"];

export const ItiCheckStatusSchema = Schema.Literals(["Valid", "Invalid", "NotChecked"]);
export type ItiCheckStatus = (typeof ItiCheckStatusSchema)["Type"];

export const ItiCertificationPathStatusSchema = Schema.Literals([
  "valid",
  "invalid",
  "not_checked",
]);
export type ItiCertificationPathStatus = (typeof ItiCertificationPathStatusSchema)["Type"];

export const ItiAttributeNameSchema = Schema.Literals([
  "IdMessageDigest",
  "IdContentType",
  "IdAaEtsSigPolicyId",
  "IdAaSigningCertificateV2",
  "SignatureDictionary",
  "signingTime",
]);
export type ItiAttributeName = (typeof ItiAttributeNameSchema)["Type"];
export const ItiAttributeNameValue: {
  readonly messageDigest: ItiAttributeName;
  readonly contentType: ItiAttributeName;
  readonly signaturePolicy: ItiAttributeName;
  readonly signingCertificateV2: ItiAttributeName;
  readonly signatureDictionary: ItiAttributeName;
  readonly signingTime: ItiAttributeName;
} = {
  messageDigest: "IdMessageDigest",
  contentType: "IdContentType",
  signaturePolicy: "IdAaEtsSigPolicyId",
  signingCertificateV2: "IdAaSigningCertificateV2",
  signatureDictionary: "SignatureDictionary",
  signingTime: "signingTime",
};

export const ItiCheckSchema = Schema.Struct({
  status: ItiCheckStatusSchema,
  message: Schema.optional(Schema.String),
});
export type ItiCheck = (typeof ItiCheckSchema)["Type"];

export const ItiAttributeCheckSchema = Schema.Struct({
  name: ItiAttributeNameSchema,
  status: ItiCheckStatusSchema,
  message: Schema.optional(Schema.String),
});
export type ItiAttributeCheck = (typeof ItiAttributeCheckSchema)["Type"];

export const ItiSignatureConformanceSchema = Schema.Struct({
  signerCommonName: Schema.NullOr(Schema.String),
  signatureType: Schema.Literal(ITI_PADES_AD_RB_SIGNATURE_TYPE),
  structure: ItiCheckSchema,
  cipher: ItiCheckSchema,
  digest: ItiCheckSchema,
  policyOid: Schema.NullOr(Schema.String),
  certificationPath: ItiCertificationPathStatusSchema,
  attributes: Schema.Array(ItiAttributeCheckSchema),
});
export type ItiSignatureConformance = (typeof ItiSignatureConformanceSchema)["Type"];

export const ItiConformanceReportSchema = Schema.Struct({
  validator: Schema.Literal(ItiOperation.conformance),
  standard: Schema.Literal(ITI_PADES_AD_RB_SIGNATURE_TYPE),
  outcome: ItiConformanceOutcomeSchema,
  approved: Schema.Boolean,
  signatureCount: Schema.Number,
  signatures: Schema.Array(ItiSignatureConformanceSchema),
});
export type ItiConformanceReport = (typeof ItiConformanceReportSchema)["Type"];

export const ItiConformanceInputSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  trustedRoots: Schema.optional(Schema.Array(Schema.Uint8Array)),
});
export type ItiConformanceInput = (typeof ItiConformanceInputSchema)["Type"];

const validCheck: ItiCheck = { status: "Valid" };

const chainStatus = (
  trustedRoots: readonly Uint8Array[] | undefined,
  chainValid: boolean,
): ItiCertificationPathStatus => {
  if (trustedRoots === undefined) return "not_checked";
  return chainValid ? "valid" : "invalid";
};

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const SPURI_OID = "1.2.840.113549.1.9.16.5.1";

type ParsedCms = {
  readonly signerInfoCount: number;
  readonly encapsulatedContentType: string;
  readonly signedAttributes: readonly pkijs.Attribute[];
};

type CmsAttributeValidity = {
  readonly messageDigest: boolean;
  readonly contentType: boolean;
  readonly signaturePolicy: boolean;
  readonly signingCertificateV2: boolean;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const toBufferSource = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

const sha256 = (bytes: Uint8Array): Effect.Effect<Uint8Array, SignatureKitError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", toBufferSource(bytes)),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.verifyFailed,
        retryable: false,
        provider: ITI_PROVIDER,
        operation: ItiOperation.conformance,
        reason: "Failed to hash the CMS signer certificate.",
      }),
  }).pipe(Effect.map((digest) => new Uint8Array(digest)));

const parseCms = (cms: Uint8Array): Effect.Effect<ParsedCms, SignatureKitError> =>
  Effect.try({
    try: () => {
      const contentInfo = pkijs.ContentInfo.fromBER(toBufferSource(cms).buffer);
      const signed = new pkijs.SignedData({ schema: contentInfo.content });
      const signer = signed.signerInfos[0];
      return {
        signerInfoCount: signed.signerInfos.length,
        encapsulatedContentType: signed.encapContentInfo.eContentType,
        signedAttributes: signer?.signedAttrs?.attributes ?? [],
      };
    },
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.verifyFailed,
        retryable: false,
        provider: ITI_PROVIDER,
        operation: ItiOperation.conformance,
        reason: "Failed to parse the CMS SignedData.",
      }),
  });

const exactAttributeValue = (attributes: readonly pkijs.Attribute[], type: string) => {
  const matching = attributes.filter((attribute) => attribute.type === type);
  const attribute = matching[0];
  if (matching.length !== 1 || attribute === undefined || attribute.values.length !== 1) {
    return undefined;
  }
  return attribute.values[0];
};

const sequenceChildren = (value: unknown) =>
  value instanceof asn1js.Sequence ? value.valueBlock.value : undefined;

const oidEquals = (value: unknown, oid: string): boolean =>
  value instanceof asn1js.ObjectIdentifier && value.valueBlock.toString() === oid;

const octetStringMatches = (value: unknown, expected: Uint8Array): boolean =>
  value instanceof asn1js.OctetString && bytesEqual(value.valueBlock.valueHexView, expected);

const isSha256AlgorithmIdentifier = (value: unknown): boolean => {
  const fields = sequenceChildren(value);
  if (fields === undefined || fields.length < 1 || fields.length > 2) return false;
  const algorithm = fields[0];
  const parameters = fields[1];
  return (
    oidEquals(algorithm, SHA256_OID) &&
    (parameters === undefined || parameters instanceof asn1js.Null)
  );
};

const isPinnedSignaturePolicy = (value: unknown): boolean => {
  const fields = sequenceChildren(value);
  if (fields === undefined || fields.length < 2 || fields.length > 3) return false;
  const policyOid = fields[0];
  const policyHash = sequenceChildren(fields[1]);
  if (
    !oidEquals(policyOid, ITI_PADES_AD_RB_POLICY_OID) ||
    policyHash === undefined ||
    policyHash.length !== 2 ||
    !isSha256AlgorithmIdentifier(policyHash[0]) ||
    !octetStringMatches(policyHash[1], IcpBrasilPadesPolicy.adRbV11.policyHash)
  ) {
    return false;
  }
  if (fields.length === 2) return true;
  const qualifiers = sequenceChildren(fields[2]);
  const qualifier = qualifiers === undefined ? undefined : sequenceChildren(qualifiers[0]);
  const qualifierOid = qualifier?.[0];
  const qualifierUri = qualifier?.[1];
  return (
    qualifiers?.length === 1 &&
    qualifier?.length === 2 &&
    oidEquals(qualifierOid, SPURI_OID) &&
    qualifierUri instanceof asn1js.IA5String &&
    qualifierUri.valueBlock.value === IcpBrasilPadesPolicy.adRbV11.policyUri
  );
};

const issuerSerialMatches = (
  issuerSerial: IssuerSerial | undefined,
  issuerSerialValue: asn1js.Sequence | undefined,
  signerCertificate: pkijs.Certificate,
): boolean => {
  if (issuerSerial === undefined) return issuerSerialValue === undefined;
  if (issuerSerialValue === undefined) return false;
  const issuerName =
    issuerSerial.issuer.length === 1 ? issuerSerial.issuer[0]?.directoryName : undefined;
  const serialNumber = sequenceChildren(issuerSerialValue)?.[1];
  return (
    issuerName !== undefined &&
    serialNumber instanceof asn1js.Integer &&
    bytesEqual(
      new Uint8Array(AsnConvert.serialize(issuerName)),
      new Uint8Array(signerCertificate.issuer.toSchema().toBER(false)),
    ) &&
    bytesEqual(
      serialNumber.valueBlock.valueHexView,
      signerCertificate.serialNumber.valueBlock.valueHexView,
    )
  );
};

const signingCertificateV2Matches = (
  value: unknown,
  certificateHash: Uint8Array,
  signerCertificateDer: Uint8Array,
): Effect.Effect<boolean, SignatureKitError> =>
  Effect.gen(function* () {
    const fields = sequenceChildren(value);
    if (fields === undefined || fields.length < 1 || fields.length > 2) return false;
    const certificates = sequenceChildren(fields[0]);
    if (certificates === undefined || certificates.length !== 1) return false;
    const certificateIdentifier = sequenceChildren(certificates[0]);
    if (
      certificateIdentifier === undefined ||
      certificateIdentifier.length === 0 ||
      certificateIdentifier.length > 3
    ) {
      return false;
    }
    const first = certificateIdentifier[0];
    const usesDefaultSha256 = first instanceof asn1js.OctetString;
    const certificateHashValue = usesDefaultSha256 ? first : certificateIdentifier[1];
    const issuerSerialValue = usesDefaultSha256
      ? certificateIdentifier[1]
      : certificateIdentifier[2];
    if (
      (!usesDefaultSha256 && !isSha256AlgorithmIdentifier(first)) ||
      !octetStringMatches(certificateHashValue, certificateHash) ||
      (issuerSerialValue !== undefined && !(issuerSerialValue instanceof asn1js.Sequence))
    ) {
      return false;
    }
    const issuerSerial =
      issuerSerialValue === undefined
        ? undefined
        : yield* Effect.try({
            try: () => AsnConvert.parse(issuerSerialValue.toBER(false), IssuerSerial),
            catch: () =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.verifyFailed,
                retryable: false,
                provider: ITI_PROVIDER,
                operation: ItiOperation.conformance,
                reason: "Failed to parse the SigningCertificateV2 issuer serial.",
              }),
          });
    const signerCertificate = yield* Effect.try({
      try: () => pkijs.Certificate.fromBER(toBufferSource(signerCertificateDer).buffer),
      catch: () =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.verifyFailed,
          retryable: false,
          provider: ITI_PROVIDER,
          operation: ItiOperation.conformance,
          reason: "Failed to parse the CMS signer certificate.",
        }),
    });
    return issuerSerialMatches(issuerSerial, issuerSerialValue, signerCertificate);
  });

const validateCmsAttributes = (
  cms: ParsedCms,
  signerCertificateDer: Uint8Array | null,
): Effect.Effect<CmsAttributeValidity, SignatureKitError> =>
  Effect.gen(function* () {
    const messageDigest = exactAttributeValue(cms.signedAttributes, CmsOid.messageDigest);
    const contentType = exactAttributeValue(cms.signedAttributes, CmsOid.contentType);
    const signaturePolicy = exactAttributeValue(cms.signedAttributes, CmsOid.signaturePolicy);
    const signingCertificate = exactAttributeValue(
      cms.signedAttributes,
      CmsOid.signingCertificateV2,
    );
    const messageDigestValid = messageDigest instanceof asn1js.OctetString;
    const contentTypeValid =
      cms.encapsulatedContentType === CmsOid.data &&
      oidEquals(contentType, cms.encapsulatedContentType);
    const signaturePolicyValid = isPinnedSignaturePolicy(signaturePolicy);
    if (signerCertificateDer === null || signingCertificate === undefined) {
      return {
        messageDigest: messageDigestValid,
        contentType: contentTypeValid,
        signaturePolicy: signaturePolicyValid,
        signingCertificateV2: false,
      };
    }
    const certificateHash = yield* sha256(signerCertificateDer);
    return {
      messageDigest: messageDigestValid,
      contentType: contentTypeValid,
      signaturePolicy: signaturePolicyValid,
      signingCertificateV2: yield* signingCertificateV2Matches(
        signingCertificate,
        certificateHash,
        signerCertificateDer,
      ).pipe(Effect.catch(() => Effect.succeed(false))),
    };
  });

export const validatePdfConformance = (
  input: ItiConformanceInput,
): Effect.Effect<ItiConformanceReport, SignatureKitError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ItiConformanceInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: ITI_PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "ItiConformanceInput",
            issueMessage: String(issue),
          }),
      ),
    );

    yield* loadPdfSignatureDocument({
      id: "iti-conformance",
      name: "document.pdf",
      pdf: valid.pdf,
    }).pipe(
      Effect.map(() => undefined),
      Effect.mapError(
        (error) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.verifyFailed,
            retryable: false,
            provider: ITI_PROVIDER,
            operation: ItiOperation.conformance,
            reason: error.reason ?? error.message,
          }),
      ),
    );

    const hasSignatureDictionary = hasPdfSignatureDictionary(valid.pdf);
    const signatures = yield* extractPdfSignatures(valid.pdf).pipe(
      Effect.catch((error) =>
        !hasSignatureDictionary && error.code === PdfErrorCodeValue.placeholderNotFound
          ? Effect.succeed([])
          : Effect.fail(
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.verifyFailed,
                retryable: false,
                provider: ITI_PROVIDER,
                operation: ItiOperation.conformance,
                reason: error.reason ?? error.message,
              }),
            ),
      ),
    );

    if (signatures.length === 0) {
      return {
        validator: ItiOperation.conformance,
        standard: ITI_PADES_AD_RB_SIGNATURE_TYPE,
        outcome: "rejected",
        approved: false,
        signatureCount: 0,
        signatures: [],
      } satisfies ItiConformanceReport;
    }

    const reports = yield* Effect.forEach(signatures, (signature, index) =>
      Effect.gen(function* () {
        const cms = yield* parseCms(signature.signature);
        const cmsVerification = yield* verifyDetachedSignedData({
          cms: signature.signature,
          content: signature.signedData,
          ...(valid.trustedRoots === undefined ? {} : { trustedRoots: valid.trustedRoots }),
        }).pipe(
          Effect.mapError(
            (error) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.verifyFailed,
                retryable: false,
                provider: ITI_PROVIDER,
                operation: ItiOperation.conformance,
                reason: error.reason ?? error.message,
              }),
          ),
        );
        const inspection = yield* inspectDetachedSignedData({ cms: signature.signature }).pipe(
          Effect.mapError(
            (error) =>
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.verifyFailed,
                retryable: false,
                provider: ITI_PROVIDER,
                operation: ItiOperation.conformance,
                reason: error.reason ?? error.message,
              }),
          ),
        );
        const cmsAttributes = yield* validateCmsAttributes(cms, inspection.signerCertificateDer);
        const newest = index === signatures.length - 1;
        const byteRangeEnd = signature.byteRange[2] + signature.byteRange[3];
        const revisionComplete = yield* isCompletePdfRevision(valid.pdf, byteRangeEnd).pipe(
          Effect.catch(() => Effect.succeed(false)),
        );
        const singleSignerInfo = cms.signerInfoCount === 1;
        const structureValid =
          signature.startsAtZero &&
          revisionComplete &&
          (!newest || signature.coversFileEnd) &&
          singleSignerInfo;
        const structureMessage = !signature.startsAtZero
          ? "A cobertura ByteRange do PDF não inicia no byte zero."
          : !revisionComplete
            ? "A cobertura ByteRange não termina em uma revisão PDF completa."
            : newest && !signature.coversFileEnd
              ? "O dicionário de assinatura não cobre todo o documento PDF."
              : "O CMS deve conter exatamente um SignerInfo por dicionário de assinatura PDF.";
        const signingTime = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.signingTime,
        );
        const policyOid = cmsAttributes.signaturePolicy ? ITI_PADES_AD_RB_POLICY_OID : null;
        const attributes: ItiAttributeCheck[] = [
          cmsAttributes.messageDigest
            ? { name: ItiAttributeNameValue.messageDigest, status: "Valid" }
            : {
                name: ItiAttributeNameValue.messageDigest,
                status: "Invalid",
                message:
                  "A assinatura não contém exatamente um atributo IdMessageDigest codificado como OCTET STRING.",
              },
          cmsAttributes.contentType
            ? { name: ItiAttributeNameValue.contentType, status: "Valid" }
            : {
                name: ItiAttributeNameValue.contentType,
                status: "Invalid",
                message: "A assinatura não contém IdContentType apontando para id-data.",
              },
          cmsAttributes.signaturePolicy
            ? { name: ItiAttributeNameValue.signaturePolicy, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signaturePolicy,
                status: "Invalid",
                message: `A assinatura não contém a política ICP-Brasil PAdES AD-RB ${ITI_PADES_AD_RB_POLICY_OID}.`,
              },
          cmsAttributes.signingCertificateV2
            ? { name: ItiAttributeNameValue.signingCertificateV2, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signingCertificateV2,
                status: "Invalid",
                message:
                  "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
              },
          structureValid
            ? { name: ItiAttributeNameValue.signatureDictionary, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signatureDictionary,
                status: "Invalid",
                message: structureMessage,
              },
          signingTime === undefined
            ? { name: ItiAttributeNameValue.signingTime, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signingTime,
                status: "Invalid",
                message: "A política PA_PAdES_AD_RB_v1_1 proíbe o atributo CMS signingTime.",
              },
        ];
        const digest: ItiCheck = cmsVerification.valid
          ? validCheck
          : {
              status: "NotChecked",
              message:
                "O verificador CMS não expõe o digest separadamente; a falha está consolidada na verificação CMS.",
            };

        return {
          signerCommonName: inspection.signerCommonName,
          signatureType: ITI_PADES_AD_RB_SIGNATURE_TYPE,
          structure: structureValid ? validCheck : { status: "Invalid", message: structureMessage },
          cipher: cmsVerification.valid
            ? validCheck
            : { status: "Invalid", message: "A cifra assimétrica da assinatura CMS é inválida." },
          digest,
          policyOid,
          certificationPath: chainStatus(valid.trustedRoots, cmsVerification.chainValid),
          attributes,
        } satisfies ItiSignatureConformance;
      }),
    );

    const attributesApproved = reports.every((report) =>
      report.attributes.every((attribute) => attribute.status === "Valid"),
    );
    const signaturesApproved = reports.every(
      (report) =>
        report.structure.status === "Valid" &&
        report.cipher.status === "Valid" &&
        report.digest.status === "Valid" &&
        report.certificationPath !== "invalid",
    );
    const approved = signaturesApproved && attributesApproved;

    return {
      validator: ItiOperation.conformance,
      standard: ITI_PADES_AD_RB_SIGNATURE_TYPE,
      outcome: approved ? "approved" : "rejected",
      approved,
      signatureCount: signatures.length,
      signatures: reports,
    } satisfies ItiConformanceReport;
  });
