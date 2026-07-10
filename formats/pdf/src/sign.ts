import type { CmsError, CmsHashAlgorithm } from "@signature-kit/cms/config";
import { IcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { createDetachedSignedData } from "@signature-kit/cms/sign";
import { signatures } from "@signature-kit/signatures";
import type { Signatures } from "@signature-kit/signatures";
import type { SignatureAlgorithm, SignatureKitError } from "@signature-kit/signatures";
import { Effect, Match, Schema } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue, PdfSigningRequestSchema } from "./config";
import type { PdfSigningRequest } from "./config";
import { bytesToHex, encodeAscii, replaceRange } from "./bytes";
import { preparePdfByteRange } from "./byte-range";
import { addSignaturePlaceholder } from "./placeholder";

const rsaSha1SignatureAlgorithm: SignatureAlgorithm = "rsa-sha1";
const rsaSha256SignatureAlgorithm: SignatureAlgorithm = "rsa-sha256";
const rsaSha512SignatureAlgorithm: SignatureAlgorithm = "rsa-sha512";

const signatureAlgorithmForHash = (
  hashAlgorithm: CmsHashAlgorithm,
): Effect.Effect<SignatureAlgorithm, PdfError> =>
  Match.value(hashAlgorithm).pipe(
    Match.when("sha1", () => Effect.succeed(rsaSha1SignatureAlgorithm)),
    Match.when("sha256", () => Effect.succeed(rsaSha256SignatureAlgorithm)),
    Match.when("sha512", () => Effect.succeed(rsaSha512SignatureAlgorithm)),
    Match.when("sha384", () =>
      Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signFailed,
          retryable: false,
          reason: `PDF signing does not support ${hashAlgorithm} with the current signer backend.`,
          operation: PdfOperationValue.sign,
        }),
      ),
    ),
    Match.exhaustive,
  );

export const signPdf = (
  input: PdfSigningRequest,
): Effect.Effect<Uint8Array, PdfError | CmsError | SignatureKitError, Signatures> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            reason: "PDF signing request failed schema validation.",
            operation: PdfOperationValue.sign,
            issueMessage: String(issue),
          }),
      ),
    );
    const hashAlgorithm = request.hashAlgorithm ?? "sha256";
    const signatureAlgorithm = yield* signatureAlgorithmForHash(hashAlgorithm);
    const placeholderPdf = yield* addSignaturePlaceholder(request);
    const prepared = yield* preparePdfByteRange(placeholderPdf);
    const [certificate, signingKey] = yield* Effect.all(
      [signatures.certificate(), signatures.importSigningKey(signatureAlgorithm)],
      { concurrency: "unbounded" },
    );
    const icpBrasil =
      request.icpBrasil ??
      (request.policy === "pades-icp-brasil" ? IcpBrasilPadesPolicy.adRbV11 : undefined);
    const cms = yield* createDetachedSignedData({
      content: prepared.signedData,
      signingKey,
      certificateDer: certificate.certificateDer,
      chainDer: certificate.intermediateCertificates,
      hashAlgorithm,
      icpBrasil,
      timestamp: request.timestamp,
    });
    const signatureHex = bytesToHex(cms);
    if (signatureHex.length > prepared.placeholderLength) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signatureTooLarge,
          retryable: false,
          reason: `CMS signature exceeds PDF placeholder length: ${signatureHex.length} > ${prepared.placeholderLength}.`,
          operation: PdfOperationValue.sign,
        }),
      );
    }

    const paddedSignature = `<${signatureHex}${"0".repeat(prepared.placeholderLength - signatureHex.length)}>`;
    return replaceRange(
      prepared.pdf,
      prepared.contentsStart,
      prepared.contentsEnd + 1,
      encodeAscii(paddedSignature),
    );
  });
