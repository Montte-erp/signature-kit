import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { parseCertificate } from "@signature-kit/certificates";
import { Effect, Redacted } from "effect";

const testPassword = Redacted.make("test1234");
const lacunaPassword = Redacted.make("1234");

const readFixture = (name: string): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))),
  );

describe("certificate parsing performance", () => {
  it.effect("keeps an ICP-Brasil fixture sweep inside a server request budget", () =>
    Effect.gen(function* () {
      const testCertificate = yield* readFixture("test-certificate.pfx");
      const turing = yield* readFixture("lacuna-turing.pfx");
      const frobenius = yield* readFixture("lacuna-frobenius.pfx");
      const fermat = yield* readFixture("lacuna-fermat.pfx");
      const wayne = yield* readFixture("lacuna-wayne.pfx");
      let parsedCount = 0;
      let sawCpf = false;
      let sawCnpj = false;

      const startedAt = performance.now();
      for (let round = 0; round < 4; round++) {
        for (const fixture of [
          { pfx: testCertificate, password: testPassword },
          { pfx: turing, password: lacunaPassword },
          { pfx: frobenius, password: lacunaPassword },
          { pfx: fermat, password: lacunaPassword },
          { pfx: wayne, password: lacunaPassword },
        ]) {
          const certificate = yield* parseCertificate(fixture.pfx, fixture.password);
          parsedCount += 1;
          sawCpf = sawCpf || certificate.brazilian.cpf !== null;
          sawCnpj = sawCnpj || certificate.brazilian.cnpj !== null;
          expect(certificate.fingerprint).toHaveLength(64);
          expect(certificate.certificateDer.byteLength).toBeGreaterThan(0);
          expect(certificate.publicKeyDer.byteLength).toBeGreaterThan(0);
        }
      }
      const elapsedMillis = performance.now() - startedAt;

      expect(parsedCount).toBe(20);
      expect(sawCpf).toBe(true);
      expect(sawCnpj).toBe(true);
      expect(elapsedMillis).toBeLessThan(10_000);
    }),
  );
});
