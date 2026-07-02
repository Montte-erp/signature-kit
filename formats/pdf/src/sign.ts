import type { CmsError } from "@signature-kit/cms/config";
import { fetchIcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { createDetachedSignedData } from "@signature-kit/cms/sign";
import { signatures } from "@signature-kit/core/signatures";
import type { Signatures } from "@signature-kit/core/signatures";
import type { SignatureAlgorithm, SignatureKitError } from "@signature-kit/core/config";
import { Effect } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config";
import type { PdfSigningRequest } from "./config";
import { bytesToHex, encodeAscii, replaceRange } from "./bytes";
import { preparePdfByteRange } from "./byte-range";
import { addSignaturePlaceholder } from "./placeholder";

const signatureAlgorithmForHash = (
  hashAlgorithm: "sha256" | "sha1" | "sha384" | "sha512",
): Effect.Effect<SignatureAlgorithm, PdfError> => {
  switch (hashAlgorithm) {
    case "sha1":
      return Effect.succeed("rsa-sha1");
    case "sha256":
      return Effect.succeed("rsa-sha256");
    case "sha512":
      return Effect.succeed("rsa-sha512");
    case "sha384":
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signFailed,
          retryable: false,
          reason: `PDF signing does not support ${hashAlgorithm} with the current signer backend.`,
          operation: PdfOperationValue.sign,
        }),
      );
  }
};

export const signPdf = (
  input: PdfSigningRequest,
): Effect.Effect<Uint8Array, PdfError | CmsError | SignatureKitError, Signatures> =>
  Effect.gen(function* () {
    const hashAlgorithm = input.hashAlgorithm ?? "sha256";
    const signatureAlgorithm = yield* signatureAlgorithmForHash(hashAlgorithm);
    const placeholderPdf = yield* addSignaturePlaceholder(input);
    const prepared = yield* preparePdfByteRange(placeholderPdf);
    const certificate = yield* signatures.certificate();
    const signingKey = yield* signatures.importSigningKey(signatureAlgorithm);
    const icpBrasil =
      input.icpBrasil ??
      (input.policy === "pades-icp-brasil"
        ? yield* fetchIcpBrasilPadesPolicy({ timeoutMillis: input.policyTimeoutMillis })
        : undefined);
    const cms = yield* createDetachedSignedData({
      content: prepared.signedData,
      signingKey,
      certificateDer: certificate.certificateDer,
      chainDer: certificate.intermediateCertificates,
      hashAlgorithm,
      signingTime: input.signingTime,
      icpBrasil,
      timestamp: input.timestamp,
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
