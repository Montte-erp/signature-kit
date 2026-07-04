import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string => readFileSync(path, "utf8");

describe("typed report construction", () => {
  it("does not re-decode reports built inside trusted ITI and CMS internals", () => {
    expect(readSource("validators/iti/src/conformance.ts")).not.toContain(
      "Schema.decodeUnknownEffect(ItiConformanceReportSchema)",
    );
    expect(readSource("validators/iti/src/remote.ts")).not.toContain(
      "Schema.decodeUnknownEffect(ItiRemoteValidationReportSchema)",
    );
    expect(readSource("shared/cms/src/inspect.ts")).not.toContain(
      "Schema.decodeUnknownEffect(CmsSignedDataInspectionSchema)",
    );
  });
});
