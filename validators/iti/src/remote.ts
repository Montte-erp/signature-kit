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
} from "./conformance";
import type { ItiConformanceOutcome, ItiConformanceReport } from "./conformance";

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

const ITI_REMOTE_STATUS_OUTCOMES: Readonly<Record<string, ItiTrustedRemoteOutcome>> = {
  aprovado: "approved",
  reprovado: "rejected",
};

const normalizeRemoteStatus = (status: string): string =>
  status.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");

const parseRemoteStatus = (status: string): ItiTrustedRemoteOutcome | undefined =>
  ITI_REMOTE_STATUS_OUTCOMES[normalizeRemoteStatus(status)];

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

const ItiPartialValidationResponseSchema = Schema.Struct({
  qtds: Schema.Tuple([Schema.Number, Schema.Number]),
  json: Schema.Unknown,
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

const ItiRemoteHttpResponseSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal(200), body: ItiVerifierReportResponseSchema }),
  Schema.Struct({ status: Schema.Literal(206), body: ItiPartialValidationResponseSchema }),
  Schema.Struct({ status: Schema.Literal(406), body: ItiUntrustedCertificateResponseSchema }),
]);
type ItiRemoteHttpResponse = (typeof ItiRemoteHttpResponseSchema)["Type"];

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

export const ItiRemotePartialReportSchema = Schema.Struct({
  validator: Schema.Literal(ItiOperation.remote),
  outcome: Schema.Literal("partial"),
  approved: Schema.Literal(false),
  processedSignatureCount: Schema.Number,
  totalSignatureCount: Schema.Number,
  conformance: ItiConformanceReportSchema,
  localConformance: ItiConformanceReportSchema,
  rawVerifierReport: Schema.Unknown,
  rawResponse: Schema.Unknown,
});
export type ItiRemotePartialReport = (typeof ItiRemotePartialReportSchema)["Type"];

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
  ItiRemotePartialReportSchema,
  ItiRemoteUntrustedCertificateReportSchema,
]);
export type ItiRemoteValidationReport = (typeof ItiRemoteValidationReportSchema)["Type"];

const submitToIti = (
  pdf: Uint8Array,
  fileName: string,
): Effect.Effect<ItiRemoteHttpResponse, SignatureKitError, SignatureHttpClient> => {
  const formData = new FormData();
  formData.append(
    "signature_files[]",
    new File([pdf.slice()], fileName, { type: "application/pdf" }),
  );
  return SignatureHttpClient.use((http) =>
    http.requestJsonResponse(
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
      ItiRemoteHttpResponseSchema,
      "ItiRemoteResponse",
    ),
  );
};

const buildRemoteReport = (
  response: ItiRemoteHttpResponse,
  conformance: ItiConformanceReport,
): Effect.Effect<ItiRemoteValidationReport> => {
  if (response.status === 206) {
    const [processedSignatureCount, totalSignatureCount] = response.body.qtds;
    return Effect.succeed({
      validator: ItiOperation.remote,
      outcome: "partial",
      approved: false,
      processedSignatureCount,
      totalSignatureCount,
      conformance,
      localConformance: conformance,
      rawVerifierReport: response.body.json,
      rawResponse: response.body,
    });
  }
  if (response.status === 406) {
    return Effect.succeed({
      validator: ItiOperation.remote,
      outcome: "untrusted_certificate",
      approved: false,
      errorCode: response.body.errorCode,
      hash: response.body.hash,
      name: response.body.nome,
      conformance,
      rawResponse: response.body,
    });
  }
  const decodedVerifierReport = parseItiVerifierReport(response.body.verifierReport);
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
    rawVerifierReport: response.body.verifierReport,
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
    const conformance = yield* validatePdfConformance({ pdf });
    const response = yield* submitToIti(pdf, valid.fileName ?? DEFAULT_FILE_NAME);
    return yield* buildRemoteReport(response, conformance);
  });
