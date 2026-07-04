import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { Effect } from "effect";
import {
  DEFAULT_EXPECTED_STATUS_WITH_FIXTURE,
  DEFAULT_EXPECTED_STATUS_WITH_TRUSTED_FIXTURE,
  SIGNED_FIXTURE,
  expectedStatus,
  itiIntegrationConfig,
  readItiFixture,
  sha256Hex,
} from "./iti.integration-helper";
import { validatePdfWithIti } from "../src/remote";

describe("ITI Validar integration", () => {
  it.effect.runIf(itiIntegrationConfig !== undefined)(
    "submits a committed PAdES ICP-Brasil PDF to the real validar.iti.gov.br endpoint",
    () =>
      Effect.gen(function* () {
        const liveConfig = itiIntegrationConfig;
        if (liveConfig === undefined) {
          return yield* Effect.die("ITI validation config was not loaded.");
        }
        const signed = yield* readItiFixture(SIGNED_FIXTURE);
        const expectedHttpStatus = expectedStatus(liveConfig.expectedStatus);

        expect(Number.isNaN(expectedHttpStatus)).toBe(false);
        expect([
          DEFAULT_EXPECTED_STATUS_WITH_FIXTURE,
          DEFAULT_EXPECTED_STATUS_WITH_TRUSTED_FIXTURE,
        ]).toContain(expectedHttpStatus);

        const localVerification = yield* verifyPdf({ pdf: signed });
        const signedHash = yield* sha256Hex(signed);

        expect(localVerification.valid).toBe(true);
        expect(localVerification.signatureCount).toBe(1);

        const report = yield* validatePdfWithIti({
          source: { pdf: signed },
          fileName: "signature-kit-validar-iti.pdf",
        }).pipe(Effect.provide(signatureHttpClientLive));

        if (expectedHttpStatus === DEFAULT_EXPECTED_STATUS_WITH_FIXTURE) {
          expect(report.outcome).toBe("untrusted_certificate");
          expect("errorCode" in report ? report.errorCode : undefined).toBe(
            DEFAULT_EXPECTED_STATUS_WITH_FIXTURE,
          );
          expect("hash" in report ? report.hash : undefined).toBe(signedHash);
          expect("name" in report ? report.name : undefined).toBe("Verificador de Conformidade");
        }

        if (expectedHttpStatus === DEFAULT_EXPECTED_STATUS_WITH_TRUSTED_FIXTURE) {
          expect(report.outcome).toBe("approved");
          expect(
            "rawVerifierReport" in report ? report.rawVerifierReport : undefined,
          ).not.toBeUndefined();
        }
      }),
    180_000,
  );
});
