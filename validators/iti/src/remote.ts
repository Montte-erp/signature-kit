import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import { SignatureHttpClient } from "@signature-kit/http";
import { Effect, Option, Schema } from "effect";
import {
  ItiConformanceOutcomeSchema,
  ItiConformanceReportSchema,
  ItiOperation,
  validatePdfConformance,
  type ItiConformanceOutcome,
  type ItiConformanceReport,
} from "./conformance";

const ITI_PROVIDER = "iti";
const ITI_SUBMISSION_URL = "https://validar.iti.gov.br/arquivo";
const DEFAULT_FILE_NAME = "signature-kit.pdf";

export const ItiPdfBytesSourceSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
});
export type ItiPdfBytesSource = (typeof ItiPdfBytesSourceSchema)["Type"];

export const ItiPdfUrlSourceSchema = Schema.Struct({
  url: Schema.NonEmptyString,
});
export type ItiPdfUrlSource = (typeof ItiPdfUrlSourceSchema)["Type"];

export const ItiRemoteValidationInputSchema = Schema.Struct({
  source: Schema.Union([ItiPdfBytesSourceSchema, ItiPdfUrlSourceSchema]),
  fileName: Schema.optional(Schema.NonEmptyString),
});
export type ItiRemoteValidationInput = (typeof ItiRemoteValidationInputSchema)["Type"];

type ItiTrustedRemoteOutcome = ItiConformanceOutcome;
type ItiTrustedRemoteVerdict = {
  readonly approved: boolean;
  readonly outcome: ItiTrustedRemoteOutcome;
};
const ItiVerifierReportPayloadSchema = Schema.Struct({
  status: Schema.optional(Schema.NonEmptyString),
  aprovado: Schema.optional(Schema.Boolean),
});
type ItiVerifierReport = (typeof ItiVerifierReportPayloadSchema)["Type"];

const parseRemoteStatus = (status: string): ItiTrustedRemoteOutcome | undefined => {
  const normalized = status.trim().toLowerCase();
  if (normalized.includes("aprov")) return "approved";
  if (normalized.includes("reprov")) return "rejected";
  return undefined;
};

const parseItiVerifierReport = (verifierReport: unknown): ItiVerifierReport | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ItiVerifierReportPayloadSchema)(verifierReport));

const getVerifierVerdict = (
  report: ItiVerifierReport | undefined,
): ItiTrustedRemoteVerdict | undefined => {
  if (report === undefined) return undefined;
  if (report.aprovado !== undefined) {
    return {
      approved: report.aprovado,
      outcome: report.aprovado ? "approved" : "rejected",
    };
  }
  if (report.status === undefined) return undefined;
  const outcome = parseRemoteStatus(report.status);
  return outcome === undefined ? undefined : { approved: outcome === "approved", outcome };
};

const ItiVerifierReportResponseSchema = Schema.Struct({
  verifierReport: Schema.Unknown,
});

const ItiUntrustedCertificateResponseSchema = Schema.Struct({
  errorCode: Schema.Number,
  hash: Schema.NonEmptyString,
  nome: Schema.NonEmptyString,
});

const ItiRemoteOutcomeSchema = Schema.Union([
  ItiConformanceOutcomeSchema,
  Schema.Literal("unknown"),
]);

const ItiRemoteResponseSchema = Schema.Union([
  ItiVerifierReportResponseSchema,
  ItiUntrustedCertificateResponseSchema,
]);

type ItiRemoteResponse = (typeof ItiRemoteResponseSchema)["Type"];

export const ItiRemoteVerifierReportSchema = Schema.Struct({
  validator: Schema.Literal(ItiOperation.remote),
  outcome: ItiRemoteOutcomeSchema,
  approved: Schema.Boolean,
  remoteOutcome: Schema.optional(ItiConformanceOutcomeSchema),
  remoteApproved: Schema.optional(Schema.Boolean),
  conformance: ItiConformanceReportSchema,
  localConformance: ItiConformanceReportSchema,
  rawVerifierReport: Schema.Unknown,
});
export type ItiRemoteVerifierReport = (typeof ItiRemoteVerifierReportSchema)["Type"];

export const ItiRemoteUntrustedCertificateReportSchema = Schema.Struct({
  validator: Schema.Literal(ItiOperation.remote),
  outcome: Schema.Literal("untrusted_certificate"),
  approved: Schema.Literal(false),
  errorCode: Schema.Number,
  hash: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  conformance: ItiConformanceReportSchema,
  rawResponse: Schema.Unknown,
});
export type ItiRemoteUntrustedCertificateReport =
  (typeof ItiRemoteUntrustedCertificateReportSchema)["Type"];

export const ItiRemoteValidationReportSchema = Schema.Union([
  ItiRemoteVerifierReportSchema,
  ItiRemoteUntrustedCertificateReportSchema,
]);
export type ItiRemoteValidationReport = (typeof ItiRemoteValidationReportSchema)["Type"];

const submitToIti = (
  pdf: Uint8Array,
  fileName: string,
): Effect.Effect<ItiRemoteResponse, SignatureKitError, SignatureHttpClient> => {
  const formData = new FormData();
  formData.append(
    "signature_files[]",
    new File([pdf.slice()], fileName, { type: "application/pdf" }),
  );
  return SignatureHttpClient.use((http) =>
    http.requestJson(
      {
        method: "POST",
        url: ITI_SUBMISSION_URL,
        provider: ITI_PROVIDER,
        body: formData,
        acceptedStatuses: [406],
        headers: {
          Origin: "https://validar.iti.gov.br",
          Referer: "https://validar.iti.gov.br/",
          "User-Agent": "Mozilla/5.0 SignatureKit ITI validator",
        },
      },
      ItiRemoteResponseSchema,
      "ItiRemoteResponse",
    ),
  );
};

const buildRemoteReport = (
  response: ItiRemoteResponse,
  conformance: ItiConformanceReport,
): Effect.Effect<ItiRemoteValidationReport> => {
  if ("verifierReport" in response) {
    const decodedVerifierReport = parseItiVerifierReport(response.verifierReport);
    const verdict = getVerifierVerdict(decodedVerifierReport);
    return Effect.succeed({
      validator: ItiOperation.remote,
      outcome: verdict?.outcome ?? "unknown",
      approved: verdict?.approved ?? false,
      ...(verdict === undefined
        ? {}
        : { remoteOutcome: verdict.outcome, remoteApproved: verdict.approved }),
      conformance,
      localConformance: conformance,
      rawVerifierReport: response.verifierReport,
    });
  }
  return Effect.succeed({
    validator: ItiOperation.remote,
    outcome: "untrusted_certificate",
    approved: false,
    errorCode: response.errorCode,
    hash: response.hash,
    name: response.nome,
    conformance,
    rawResponse: response,
  });
};

export const validatePdfWithIti = (
  input: ItiRemoteValidationInput,
): Effect.Effect<ItiRemoteValidationReport, SignatureKitError, SignatureHttpClient> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(ItiRemoteValidationInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            provider: ITI_PROVIDER,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "ItiRemoteValidationInput",
            issueMessage: String(issue),
          }),
      ),
    );
    const source = valid.source;
    let pdf: Uint8Array;
    if ("pdf" in source) {
      pdf = source.pdf;
    } else {
      pdf = yield* SignatureHttpClient.use((http) =>
        http.requestBytes({
          method: "GET",
          url: source.url,
          provider: ITI_PROVIDER,
        }),
      );
    }
    const response = yield* submitToIti(pdf, valid.fileName ?? DEFAULT_FILE_NAME);
    const conformance = yield* validatePdfConformance({ pdf });
    const report = yield* buildRemoteReport(response, conformance);
    return report;
  });
