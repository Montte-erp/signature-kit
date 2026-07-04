import { CmsOid } from "@signature-kit/cms/config";
import { IcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { inspectDetachedSignedData } from "@signature-kit/cms/inspect";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import { extractPdfSignatures } from "@signature-kit/pdf/byte-range";
import { PdfErrorCodeValue } from "@signature-kit/pdf/config";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { Effect, Schema } from "effect";

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

    const signatures = yield* extractPdfSignatures(valid.pdf).pipe(
      Effect.catch((error) =>
        error.code === PdfErrorCodeValue.placeholderNotFound
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
      };
    }

    const pdfVerification = yield* verifyPdf({
      pdf: valid.pdf,
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

    const reports = yield* Effect.forEach(signatures, (signature, index) =>
      Effect.gen(function* () {
        const newest = index === signatures.length - 1;
        const structureValid = signature.startsAtZero && (newest ? signature.coversFileEnd : true);
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
        const contentType = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.contentType,
        );
        const messageDigest = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.messageDigest,
        );
        const signaturePolicy = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.signaturePolicy,
        );
        const signingCertificate = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.signingCertificateV2,
        );
        const signingTime = inspection.signedAttributes.find(
          (attribute) => attribute.type === CmsOid.signingTime,
        );
        const policyOid =
          signaturePolicy?.signaturePolicyId === ITI_PADES_AD_RB_POLICY_OID
            ? ITI_PADES_AD_RB_POLICY_OID
            : null;
        const attributes: ItiAttributeCheck[] = [
          messageDigest !== undefined
            ? { name: ItiAttributeNameValue.messageDigest, status: "Valid" }
            : {
                name: ItiAttributeNameValue.messageDigest,
                status: "Invalid",
                message: "A assinatura não contém o atributo obrigatório IdMessageDigest.",
              },
          contentType?.valueOids.includes(CmsOid.data) === true
            ? { name: ItiAttributeNameValue.contentType, status: "Valid" }
            : {
                name: ItiAttributeNameValue.contentType,
                status: "Invalid",
                message: "A assinatura não contém IdContentType apontando para id-data.",
              },
          policyOid === ITI_PADES_AD_RB_POLICY_OID
            ? { name: ItiAttributeNameValue.signaturePolicy, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signaturePolicy,
                status: "Invalid",
                message: `A assinatura não contém a política ICP-Brasil PAdES AD-RB ${ITI_PADES_AD_RB_POLICY_OID}.`,
              },
          signingCertificate !== undefined
            ? { name: ItiAttributeNameValue.signingCertificateV2, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signingCertificateV2,
                status: "Invalid",
                message: "A assinatura não contém o atributo obrigatório IdAaSigningCertificateV2.",
              },
          structureValid
            ? { name: ItiAttributeNameValue.signatureDictionary, status: "Valid" }
            : {
                name: ItiAttributeNameValue.signatureDictionary,
                status: "Invalid",
                message: newest
                  ? "O dicionário de assinatura não cobre todo o documento PDF."
                  : "O dicionário de assinatura incremental não inicia no byte zero.",
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

        const report: ItiSignatureConformance = {
          signerCommonName: inspection.signerCommonName,
          signatureType: ITI_PADES_AD_RB_SIGNATURE_TYPE,
          structure: structureValid
            ? validCheck
            : { status: "Invalid", message: "A cobertura ByteRange do PDF é inválida." },
          cipher: cmsVerification.valid
            ? validCheck
            : { status: "Invalid", message: "A cifra assimétrica da assinatura CMS é inválida." },
          digest,
          policyOid,
          certificationPath: chainStatus(valid.trustedRoots, cmsVerification.chainValid),
          attributes,
        };
        return report;
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
    const approved = pdfVerification.valid && signaturesApproved && attributesApproved;

    const outcome: ItiConformanceOutcome = approved ? "approved" : "rejected";
    const report: ItiConformanceReport = {
      validator: ItiOperation.conformance,
      standard: ITI_PADES_AD_RB_SIGNATURE_TYPE,
      outcome,
      approved,
      signatureCount: signatures.length,
      signatures: reports,
    };
    return report;
  });
