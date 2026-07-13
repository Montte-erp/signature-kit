import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import {
  daysUntilExpiry,
  extractBrazilianFields,
  isCertificateValid,
  parseCertificate,
  parseX509,
} from "../src/index";
import { Effect, Redacted, Result } from "effect";

const testPassword = Redacted.make("test1234");
const lacunaPassword = Redacted.make("1234");

const readFixture = (name: string): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))),
  );

const binaryString = (bytes: Uint8Array): string => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
};

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const derLength = (length: number): Uint8Array =>
  length < 0x80
    ? new Uint8Array([length])
    : length < 0x100
      ? new Uint8Array([0x81, length])
      : new Uint8Array([0x82, length >> 8, length & 0xff]);

const der = (tag: number, content: Uint8Array): Uint8Array =>
  concatBytes(new Uint8Array([tag]), derLength(content.length), content);

const sequence = (...children: Uint8Array[]): Uint8Array => der(0x30, concatBytes(...children));
const set = (...children: Uint8Array[]): Uint8Array => der(0x31, concatBytes(...children));
const primitive = (tag: number, value: Uint8Array): Uint8Array => der(tag, value);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const time = (tag: number, value: string): Uint8Array => primitive(tag, text(value));
const contextConstructed = (tag: number, ...children: Uint8Array[]): Uint8Array =>
  der(0xa0 | tag, concatBytes(...children));

const distinguishedName = (
  value: Uint8Array,
  oid: Uint8Array = new Uint8Array([0x55, 0x04, 0x03]),
): Uint8Array => sequence(set(sequence(primitive(0x06, oid), value)));

const utf8Name = (value: string): Uint8Array => distinguishedName(primitive(0x0c, text(value)));

const subjectAltNameExtension = (generalNames: Uint8Array): Uint8Array =>
  contextConstructed(
    3,
    sequence(
      sequence(primitive(0x06, new Uint8Array([0x55, 0x1d, 0x11])), primitive(0x04, generalNames)),
    ),
  );

const minimalX509 = (
  validity: Uint8Array,
  issuer: Uint8Array = utf8Name("Issuer"),
  subject: Uint8Array = utf8Name("Subject"),
  generalNames: Uint8Array | null = null,
): Uint8Array => {
  const tbs = [
    primitive(0x02, new Uint8Array([0x01])),
    sequence(),
    issuer,
    validity,
    subject,
    sequence(),
  ];
  if (generalNames !== null) tbs.push(subjectAltNameExtension(generalNames));
  return sequence(sequence(...tbs), sequence(), primitive(0x03, new Uint8Array([0x00])));
};
const minimalX509WithVersion = (validity: Uint8Array, version: Uint8Array): Uint8Array => {
  const tbs = [
    version,
    primitive(0x02, new Uint8Array([0x01])),
    sequence(),
    utf8Name("Issuer"),
    validity,
    utf8Name("Subject"),
    sequence(),
  ];
  return sequence(sequence(...tbs), sequence(), primitive(0x03, new Uint8Array([0x00])));
};

type X509Tags = Partial<{
  certificate: number;
  tbs: number;
  serial: number;
  issuer: number;
  spki: number;
}>;

const minimalX509WithTags = (tags: X509Tags): Uint8Array => {
  const issuer = der(
    tags.issuer ?? 0x30,
    concatBytes(
      set(
        sequence(
          primitive(0x06, new Uint8Array([0x55, 0x04, 0x03])),
          primitive(0x0c, text("Issuer")),
        ),
      ),
    ),
  );
  const tbs = der(
    tags.tbs ?? 0x30,
    concatBytes(
      primitive(tags.serial ?? 0x02, new Uint8Array([0x01])),
      sequence(),
      issuer,
      validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
      utf8Name("Subject"),
      der(tags.spki ?? 0x30, new Uint8Array()),
    ),
  );
  return der(
    tags.certificate ?? 0x30,
    concatBytes(tbs, sequence(), primitive(0x03, new Uint8Array([0x00]))),
  );
};

const validity = (notBefore: Uint8Array, notAfter: Uint8Array): Uint8Array =>
  sequence(notBefore, notAfter);

describe("certificates", () => {
  it.effect("parses a valid PKCS#12 file and exposes certificate material", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const cert = yield* parseCertificate(pfx, testPassword);

      expect(cert.serialNumber).not.toBe("");
      expect(cert.certPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(Redacted.value(cert.privateKeyPem)).toContain("-----BEGIN PRIVATE KEY-----");
      expect(cert.certificateDer.byteLength).toBeGreaterThan(0);
      expect(cert.publicKeyDer.byteLength).toBeGreaterThan(0);
      expect(Object.hasOwn(cert, "pfxBuffer")).toBe(false);
      expect(Object.hasOwn(cert, "pfxPassword")).toBe(false);
    }),
  );

  it.effect("normalizes ArrayBufferView and binary string certificate inputs", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const padded = new Uint8Array(pfx.length + 4);
      padded.set([0xff, 0xff], 0);
      padded.set(pfx, 2);
      const view = new DataView(padded.buffer, 2, pfx.length);

      const fromBytes = yield* parseCertificate(pfx, testPassword);
      const fromView = yield* parseCertificate(view, testPassword);
      const fromBinary = yield* parseCertificate(binaryString(pfx), testPassword);

      expect(fromView.serialNumber).toBe(fromBytes.serialNumber);
      expect(fromBinary.serialNumber).toBe(fromBytes.serialNumber);
    }),
  );

  it.effect("extracts subject issuer validity fingerprint and Brazilian identity", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const cert = yield* parseCertificate(pfx, testPassword);

      expect(cert.subject.commonName).toBe("Test Company LTDA");
      expect(cert.subject.organization).toBe("Test Org");
      expect(cert.subject.country).toBe("BR");
      expect(cert.subject.raw.length).toBeGreaterThan(0);
      expect(cert.issuer.commonName).toBe("Test Company LTDA");
      expect(cert.issuer.organization).toBe("Test Org");
      expect(cert.validity.notAfter.getTime()).toBeGreaterThan(cert.validity.notBefore.getTime());
      expect(cert.fingerprint).toHaveLength(64);
      expect(cert.isValid).toBe(true);
      expect(isCertificateValid(cert)).toBe(true);
      expect(daysUntilExpiry(cert)).toBeGreaterThan(0);
      expect(cert.brazilian.cnpj).toBe("12345678000190");
    }),
  );

  it.effect("extracts CPF and CNPJ from ICP-Brasil subjectAltName otherName", () =>
    Effect.gen(function* () {
      const turing = yield* readFixture("lacuna-turing.pfx");
      const wayne = yield* readFixture("lacuna-wayne.pfx");

      const cpfCert = yield* parseCertificate(turing, lacunaPassword);
      const cnpjCert = yield* parseCertificate(wayne, lacunaPassword);

      expect(cpfCert.brazilian.cpf).toBe("56072386105");
      expect(cpfCert.subjectAltName).toContain("CPF=56072386105");
      expect(cnpjCert.brazilian.cnpj).toBe("34785515000166");
      expect(cnpjCert.subjectAltName).toContain("CNPJ=34785515000166");
    }),
  );

  it("anchors CNPJ extraction to explicit ICP-Brasil CNPJ fields", () => {
    expect(
      extractBrazilianFields("CN=Company 12345678000190, OU=Support 11111111111111", null).cnpj,
    ).toBeNull();
    expect(extractBrazilianFields("CN=Company, CNPJ=12.345.678/0001-90", null).cnpj).toBe(
      "12345678000190",
    );
    expect(extractBrazilianFields("", "2.16.76.1.3.3=34.785.515/0001-66").cnpj).toBe(
      "34785515000166",
    );
  });

  it("anchors CPF extraction to an exact labelled field", () => {
    expect(extractBrazilianFields("CN=Company, CPF=12345678901", null).cpf).toBe("12345678901");
    expect(extractBrazilianFields("CN=Company, CPF=123.456.789-01", null).cpf).toBe("12345678901");
    expect(extractBrazilianFields("CN=Company, CPF=123456789012", null).cpf).toBeNull();
    expect(extractBrazilianFields("CN=Company, CPF=123.456.789-012", null).cpf).toBeNull();
    expect(extractBrazilianFields("CN=Company, CPF=12345678901-2", null).cpf).toBeNull();
    expect(extractBrazilianFields("CN=Company, notCPF=12345678901", null).cpf).toBeNull();
    expect(extractBrazilianFields("CN=Company, CPF=12345678901x", null).cpf).toBeNull();
  });

  it.effect("accepts documented UTCTime seconds omission and rejects impossible dates", () =>
    Effect.gen(function* () {
      const utcWithoutSeconds = yield* parseX509(
        minimalX509(validity(time(23, "2401010000Z"), time(23, "250101000000Z"))),
      );
      const generalizedTime = yield* parseX509(
        minimalX509(validity(time(24, "20500228010203Z"), time(24, "20510228010203Z"))),
      );

      expect(utcWithoutSeconds.validity.notBefore.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      expect(generalizedTime.validity.notBefore.toISOString()).toBe("2050-02-28T01:02:03.000Z");

      const malformedTimes = [
        "241301000000Z",
        "240231000000Z",
        "240101240000Z",
        "240101006000Z",
        "240101000060Z",
        "240101000000",
        "240101000000Z ",
        "240101000000+0000",
        "240101000000+2460",
      ];
      for (const malformed of malformedTimes) {
        const result = yield* Effect.result(
          parseX509(minimalX509(validity(time(23, malformed), time(23, "250101000000Z")))),
        );
        expect(Result.isFailure(result), malformed).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("signature-kit.X509_PARSE_FAILED");
        }
      }

      const invalidGeneralizedYear = yield* Effect.result(
        parseX509(minimalX509(validity(time(24, "20490101000000Z"), time(24, "20500101000000Z")))),
      );
      expect(Result.isFailure(invalidGeneralizedYear)).toBe(true);
      if (Result.isFailure(invalidGeneralizedYear)) {
        expect(invalidGeneralizedYear.failure.code).toBe("signature-kit.X509_PARSE_FAILED");
      }
    }),
  );
  it.effect("rejects malformed validity and explicit version structures", () =>
    Effect.gen(function* () {
      const validValidity = validity(time(23, "240101000000Z"), time(23, "250101000000Z"));
      for (const versionValue of [0, 1, 2]) {
        const result = yield* Effect.result(
          parseX509(
            minimalX509WithVersion(
              validValidity,
              contextConstructed(0, primitive(0x02, new Uint8Array([versionValue]))),
            ),
          ),
        );
        expect(Result.isSuccess(result), `version ${versionValue}`).toBe(true);
      }
      const malformed: ReadonlyArray<readonly [string, Uint8Array]> = [
        [
          "validity child extra",
          minimalX509(
            sequence(
              time(23, "240101000000Z"),
              time(23, "250101000000Z"),
              time(23, "250201000000Z"),
            ),
          ),
        ],
        [
          "validity interval inverted",
          minimalX509(validity(time(23, "250101000000Z"), time(23, "240101000000Z"))),
        ],
        [
          "version wrapper not constructed",
          minimalX509WithVersion(validValidity, primitive(0x80, new Uint8Array([0x00]))),
        ],
        [
          "version child wrong type",
          minimalX509WithVersion(
            validValidity,
            contextConstructed(0, primitive(0x04, new Uint8Array([0x00]))),
          ),
        ],
        [
          "version out of range",
          minimalX509WithVersion(
            validValidity,
            contextConstructed(0, primitive(0x02, new Uint8Array([0x03]))),
          ),
        ],
      ];

      for (const [label, malformedDer] of malformed) {
        const result = yield* Effect.result(parseX509(malformedDer));
        expect(Result.isFailure(result), label).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code, label).toBe("signature-kit.X509_PARSE_FAILED");
        }
      }
    }),
  );

  it.effect("rejects an empty X.509 issuer name", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        parseX509(
          minimalX509(validity(time(23, "240101000000Z"), time(23, "250101000000Z")), sequence()),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.X509_PARSE_FAILED");
      }
    }),
  );

  it.effect("rejects an X.509 issuer without an AttributeTypeAndValue", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        parseX509(
          minimalX509(
            validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
            sequence(set()),
          ),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.X509_PARSE_FAILED");
      }
    }),
  );

  it.effect("rejects X.509 nodes with non-universal required tags", () =>
    Effect.gen(function* () {
      const malformed: ReadonlyArray<readonly [string, Uint8Array]> = [
        ["certificate tag", minimalX509WithTags({ certificate: 0x31 })],
        ["certificate class", minimalX509WithTags({ certificate: 0xa0 })],
        ["tbs tag", minimalX509WithTags({ tbs: 0x31 })],
        ["tbs class", minimalX509WithTags({ tbs: 0xa0 })],
        ["serial tag", minimalX509WithTags({ serial: 0x04 })],
        ["issuer tag", minimalX509WithTags({ issuer: 0x31 })],
        ["spki tag", minimalX509WithTags({ spki: 0x31 })],
      ];

      for (const [label, malformedDer] of malformed) {
        const result = yield* Effect.result(parseX509(malformedDer));
        expect(Result.isFailure(result), label).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code, label).toBe("signature-kit.X509_PARSE_FAILED");
        }
      }
    }),
  );

  it.effect("preserves unfamiliar issuer attribute OIDs in raw output", () =>
    Effect.gen(function* () {
      const parsed = yield* parseX509(
        minimalX509(
          validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
          distinguishedName(
            primitive(0x0c, text("Custom Issuer")),
            new Uint8Array([0x2a, 0x03, 0x04]),
          ),
        ),
      );

      expect(parsed.issuer.raw).toBe("1.2.3.4=Custom Issuer");
    }),
  );

  it.effect("decodes X.509 UniversalString values as UTF-32BE", () =>
    Effect.gen(function* () {
      const universalSubject = distinguishedName(
        primitive(
          0x1c,
          new Uint8Array([0x00, 0x00, 0x00, 0x4f, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00, 0xe1]),
        ),
      );
      const parsed = yield* parseX509(
        minimalX509(
          validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
          utf8Name("Issuer"),
          universalSubject,
        ),
      );

      expect(parsed.subject.commonName).toBe("Olá");
      expect(parsed.subject.raw).toBe("CN=Olá");
    }),
  );

  it.effect("unwraps directoryName subject alternative names", () =>
    Effect.gen(function* () {
      const parsed = yield* parseX509(
        minimalX509(
          validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
          utf8Name("Issuer"),
          utf8Name("Subject"),
          sequence(contextConstructed(4, utf8Name("Alt Name"))),
        ),
      );

      expect(parsed.subjectAltName).toBe("CN=Alt Name");
    }),
  );

  it.effect("renders binary IP address and registered ID subject alternative names", () =>
    Effect.gen(function* () {
      const parsed = yield* parseX509(
        minimalX509(
          validity(time(23, "240101000000Z"), time(23, "250101000000Z")),
          utf8Name("Issuer"),
          utf8Name("Subject"),
          sequence(
            primitive(0x87, new Uint8Array([127, 0, 0, 1])),
            primitive(
              0x87,
              new Uint8Array([
                0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x01,
              ]),
            ),
            primitive(0x88, new Uint8Array([0x2a, 0x03, 0x04])),
          ),
        ),
      );

      expect(parsed.subjectAltName).toBe("127.0.0.1, 2001:db8::1, 1.2.3.4");
    }),
  );

  it.effect("keeps parse failures in the typed Effect error channel", () =>
    Effect.gen(function* () {
      const pfx = yield* readFixture("test-certificate.pfx");
      const wrongPassword = yield* Effect.result(
        parseCertificate(pfx, Redacted.make("wrongpassword")),
      );
      const invalidText = yield* Effect.result(
        parseCertificate(new TextEncoder().encode("not a pfx"), testPassword),
      );
      const empty = yield* Effect.result(parseCertificate(new Uint8Array(0), testPassword));
      const fakePdf = yield* Effect.result(
        parseCertificate(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]), testPassword),
      );
      const fakePng = yield* Effect.result(
        parseCertificate(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), testPassword),
      );

      expect(Result.isFailure(wrongPassword)).toBe(true);
      if (Result.isFailure(wrongPassword)) {
        expect(wrongPassword.failure.code).toBe("signature-kit.WRONG_PASSWORD");
        expect(wrongPassword.failure.reason).toBeDefined();
      }
      expect(Result.isFailure(invalidText)).toBe(true);
      if (Result.isFailure(invalidText)) {
        expect(invalidText.failure.code).toBe("signature-kit.INVALID_FORMAT");
      }
      expect(Result.isFailure(empty)).toBe(true);
      if (Result.isFailure(empty)) {
        expect(empty.failure.code).toBe("signature-kit.EMPTY_FILE");
      }
      expect(Result.isFailure(fakePdf)).toBe(true);
      if (Result.isFailure(fakePdf)) {
        expect(fakePdf.failure.code).toBe("signature-kit.INVALID_FORMAT");
        expect(fakePdf.failure.message).toContain("PDF");
      }
      expect(Result.isFailure(fakePng)).toBe(true);
      if (Result.isFailure(fakePng)) {
        expect(fakePng.failure.code).toBe("signature-kit.INVALID_FORMAT");
        expect(fakePng.failure.message).toContain("PNG");
      }
    }),
  );

  it.effect("parses the Lacuna ICP-Brasil fixture sweep", () =>
    Effect.gen(function* () {
      const turing = yield* parseCertificate(
        yield* readFixture("lacuna-turing.pfx"),
        lacunaPassword,
      );
      const frobenius = yield* parseCertificate(
        yield* readFixture("lacuna-frobenius.pfx"),
        lacunaPassword,
      );
      const fermat = yield* parseCertificate(
        yield* readFixture("lacuna-fermat.pfx"),
        lacunaPassword,
      );
      const wayne = yield* parseCertificate(yield* readFixture("lacuna-wayne.pfx"), lacunaPassword);

      expect(turing.brazilian.cpf).toBe("56072386105");
      expect(frobenius.brazilian.cpf).toBe("87378011126");
      expect(fermat.brazilian.cpf).toBe("47363361886");
      expect(wayne.brazilian.cnpj).toBe("34785515000166");
    }),
  );
});
