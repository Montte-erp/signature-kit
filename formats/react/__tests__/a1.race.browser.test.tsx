import { Effect } from "effect";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { afterEach, describe, expect, it } from "vitest";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";
import {
  clearA1Certificate,
  clearA1Signer,
  getLoadedA1CertificateProfile,
  loadA1Certificate,
} from "@signature-kit/react/a1";

describe("A1 worker session ownership", () => {
  afterEach(() => {
    clearA1Certificate();
    clearA1Signer();
  });

  it("discards an interrupted load and retains a later load", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const first = loadA1Certificate(pfx, "changeit");
    clearA1Certificate();
    const second = loadA1Certificate(pfx, "changeit");
    expect(await first).toMatchObject({
      ok: false,
      error: { code: SignatureKitErrorCodeValue.unsupportedOperation },
    });
    const result = await second;
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(getLoadedA1CertificateProfile()?.fingerprint).toBe(result.profile.fingerprint);
  }, 30000);

  it("does not publish a certificate after clear", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const pending = loadA1Certificate(pfx, "changeit");
    clearA1Certificate();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: SignatureKitErrorCodeValue.unsupportedOperation },
    });
    expect(getLoadedA1CertificateProfile()).toBeNull();
  }, 30000);

  it("does not restore a replaced certificate after a failed replacement", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    expect((await loadA1Certificate(pfx, "changeit")).ok).toBe(true);
    const replacement = loadA1Certificate(pfx, "incorrect-password");
    expect(getLoadedA1CertificateProfile()).toBeNull();
    expect((await replacement).ok).toBe(false);
    expect(getLoadedA1CertificateProfile()).toBeNull();
  }, 30000);
});
