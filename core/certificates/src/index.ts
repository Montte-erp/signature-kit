import { decode, encode, oidString } from "@signature-kit/asn1";
import type { Asn1Error, Asn1Node } from "@signature-kit/asn1";
import type { CryptoError } from "@signature-kit/crypto/config";
import { derToPem } from "@signature-kit/crypto/pem";
import { parsePkcs12 } from "@signature-kit/crypto/pkcs12";
import {
  CertificateIssuerSchema,
  CertificateSubjectSchema,
  CertificateValiditySchema,
  CertificateSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import type { BrazilianFields, Certificate, SignerIdentity } from "@signature-kit/signatures";
import type { Redacted } from "effect";
import { Effect, Match, Schema } from "effect";

const OID_COMMON_NAME = "2.5.4.3";
const OID_COUNTRY = "2.5.4.6";
const OID_LOCALITY = "2.5.4.7";
const OID_STATE = "2.5.4.8";
const OID_ORGANIZATION = "2.5.4.10";
const OID_ORGANIZATIONAL_UNIT = "2.5.4.11";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";
const HEX_ALPHABET = "0123456789abcdef";

const ICP_BRASIL_OID_LABELS: Record<string, string> = {
  "2.16.76.1.3.1": "CPF",
  "2.16.76.1.3.2": "ICP-Brasil-Name",
  "2.16.76.1.3.3": "CNPJ",
  "2.16.76.1.3.4": "ICP-Brasil-Responsible",
  "2.16.76.1.3.5": "ICP-Brasil-Voter",
  "2.16.76.1.3.6": "ICP-Brasil-INSS",
  "2.16.76.1.3.7": "ICP-Brasil-CEI",
  "2.16.76.1.3.8": "ICP-Brasil-OAB",
};

export const X509InfoSchema = Schema.Struct({
  serialNumber: Schema.NonEmptyString,
  subject: CertificateSubjectSchema,
  issuer: CertificateIssuerSchema,
  validity: CertificateValiditySchema,
  subjectAltName: Schema.NullOr(Schema.String),
  publicKeyDer: Schema.Uint8Array,
});
export type X509Info = (typeof X509InfoSchema)["Type"];

const ArrayBufferViewSchema = Schema.declare<ArrayBufferView>((source): source is ArrayBufferView =>
  ArrayBuffer.isView(source),
);

const ArrayBufferSchema = Schema.declare<ArrayBuffer>(
  (source): source is ArrayBuffer =>
    Object.prototype.toString.call(source) === "[object ArrayBuffer]",
);

export const CertificateSourceSchema = Schema.Union([
  Schema.String,
  ArrayBufferSchema,
  ArrayBufferViewSchema,
]);
export type CertificateSource = (typeof CertificateSourceSchema)["Type"];

export const parseCertificate = (
  source: CertificateSource,
  password: Redacted.Redacted<string>,
): Effect.Effect<Certificate, SignatureKitError> =>
  Effect.gen(function* () {
    const validSource = yield* Schema.decodeUnknownEffect(CertificateSourceSchema)(source).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid certificate source.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "CertificateSource",
            issueMessage: String(issue),
          }),
      ),
    );
    const pfx = certificateBytes(validSource);
    if (pfx.length === 0) {
      return yield* Effect.fail(
        new SignatureKitError({ code: SignatureKitErrorCodeValue.emptyFile, retryable: false }),
      );
    }
    if (!isLikelyPkcs12(pfx)) {
      const detected = detectFileType(pfx);
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidFormat,
          retryable: false,
          reason: `The file does not appear to be a PKCS#12 certificate${detected === null ? "" : ` (detected: ${detected})`}.`,
        }),
      );
    }

    const pkcs12 = yield* parsePkcs12(pfx, password).pipe(
      Effect.mapError(
        (error) =>
          new SignatureKitError({
            code: cryptoErrorCode(error),
            retryable: false,
            reason: error.reason ?? error.message,
            operation: SignatureKitOperationValue.pkcs12Parse,
          }),
      ),
    );
    const certPem = derToPem(pkcs12.certificate, "CERTIFICATE");
    const keyPem = derToPem(pkcs12.privateKey, "PRIVATE KEY");
    const [x509, fingerprint] = yield* Effect.all(
      [parseX509(pkcs12.certificate), digestSha256Hex(pkcs12.certificate)],
      { concurrency: "unbounded" },
    );

    return yield* Schema.decodeUnknownEffect(CertificateSchema)({
      serialNumber: x509.serialNumber,
      subject: x509.subject,
      issuer: x509.issuer,
      validity: x509.validity,
      fingerprint,
      subjectAltName: x509.subjectAltName,
      isValid: isValidityRangeCurrent(x509.validity),
      brazilian: extractBrazilianFields(x509.subject.raw, x509.subjectAltName),
      certPem,
      certificateDer: pkcs12.certificate,
      intermediateCertificates: pkcs12.chain,
      publicKeyDer: x509.publicKeyDer,
      privateKeyPem: keyPem,
    }).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.x509ParseFailed,
            retryable: false,
            reason: "Invalid parsed X.509 certificate.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "Certificate",
            issueMessage: String(issue),
          }),
      ),
    );
  });

export const extractBrazilianFields = (
  subjectRaw: string,
  subjectAltName: string | null,
): BrazilianFields => {
  const cnpj =
    extractCnpj(subjectRaw) ?? (subjectAltName === null ? null : extractCnpj(subjectAltName));
  const cpf =
    extractCpf(subjectRaw) ?? (subjectAltName === null ? null : extractCpf(subjectAltName));
  return { cnpj, cpf };
};

export const toSignerIdentity = (cert: Certificate): SignerIdentity => {
  const document = cert.brazilian.cnpj ?? cert.brazilian.cpf;
  return {
    subject: cert.subject.raw,
    issuer: cert.issuer.raw,
    serialNumber: cert.serialNumber,
    thumbprint: cert.fingerprint,
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    ...(document === null ? {} : { document }),
  };
};

export const isCertificateValid = (cert: Certificate): boolean =>
  isValidityRangeCurrent(cert.validity);

export const daysUntilExpiry = (cert: Certificate): number =>
  Math.floor((cert.validity.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

const certificateBytes = (source: CertificateSource): Uint8Array => {
  if (typeof source === "string") {
    const bytes = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index++) {
      bytes[index] = source.charCodeAt(index) & 0xff;
    }
    return bytes;
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return new Uint8Array(source);
};

const cryptoErrorCode = (error: CryptoError): SignatureKitError["code"] =>
  Match.value(error.code).pipe(
    Match.when("crypto.WRONG_PASSWORD", () => SignatureKitErrorCodeValue.wrongPassword),
    Match.when(
      "crypto.UNSUPPORTED_ALGORITHM",
      () => SignatureKitErrorCodeValue.unsupportedAlgorithm,
    ),
    Match.when("crypto.NO_CERTIFICATE", () => SignatureKitErrorCodeValue.noCertificate),
    Match.when("crypto.NO_PRIVATE_KEY", () => SignatureKitErrorCodeValue.noPrivateKey),
    Match.when("crypto.INVALID_FORMAT", () => SignatureKitErrorCodeValue.invalidFormat),
    Match.whenOr(
      "crypto.DECODE_ERROR",
      "crypto.CORRUPTED_FILE",
      "crypto.CIPHER_ERROR",
      () => SignatureKitErrorCodeValue.corruptedFile,
    ),
    Match.when("crypto.UNKNOWN", () => SignatureKitErrorCodeValue.unknown),
    Match.exhaustive,
  );

const isValidityRangeCurrent = (validity: Certificate["validity"]): boolean => {
  const now = Date.now();
  return now >= validity.notBefore.getTime() && now <= validity.notAfter.getTime();
};

const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};

const digestSha256Hex = (data: Uint8Array): Effect.Effect<string, SignatureKitError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", toBufferSource(data)),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.digestFailed,
        retryable: false,
        operation: SignatureKitOperationValue.cryptoDigest,
      }),
  }).pipe(Effect.map((buffer) => bytesToHex(new Uint8Array(buffer))));

const isLikelyPkcs12 = (data: Uint8Array): boolean => data.length >= 4 && data[0] === 0x30;

const detectFileType = (data: Uint8Array): string | null => {
  if (data.length < 4) return "file too small";
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return "PDF";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "PNG";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "JPEG";
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04)
    return "ZIP/Office";
  if (data[0] === 0x2d && data[1] === 0x2d && data[2] === 0x2d && data[3] === 0x2d)
    return "PEM text";
  return null;
};

const extractCnpj = (raw: string): string | null => {
  const cnpj = raw.match(/(?:^|[^A-Za-z0-9])(?:CNPJ|2\.16\.76\.1\.3\.3)\s*[:=]\s*([\d./-]+)/i);
  const digits = cnpj?.[1]?.replace(/\D/g, "") ?? null;
  return digits !== null && digits.length === 14 ? digits : null;
};

const extractCpf = (raw: string): string | null => {
  const labelled = raw.match(/(?:^|[^A-Za-z0-9])CPF[:\s=]+([\d./-]+)(?=$|[,\s])/i);
  const digits = labelled?.[1]?.replace(/\D/g, "") ?? null;
  return digits !== null && digits.length === 11 ? digits : null;
};

const utf16BeDecoder = new TextDecoder("utf-16be");

const decodeUniversalString = (bytes: Uint8Array): string => {
  let decoded = "";
  let offset = 0;
  while (offset + 3 < bytes.length) {
    const codePoint =
      (bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0);
    decoded +=
      codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    offset += 4;
  }
  return offset === bytes.length ? decoded : `${decoded}\uFFFD`;
};

const decodeDirectoryValue = (valueNode: Asn1Node): string => {
  if (valueNode.tag === 0x1e && valueNode.kind === "primitive") {
    return valueNode.bytes.length === 0 ? "" : utf16BeDecoder.decode(valueNode.bytes);
  }
  if (valueNode.tag === 0x1c && valueNode.kind === "primitive") {
    return decodeUniversalString(valueNode.bytes);
  }
  return valueNode.kind === "primitive" ? decodeText(valueNode.bytes) : "";
};

const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesToHex = (bytes: Uint8Array): string => {
  let output = "";
  for (const byte of bytes) {
    output += HEX_ALPHABET[(byte >> 4) & 0x0f] ?? "";
    output += HEX_ALPHABET[byte & 0x0f] ?? "";
  }
  return output;
};

const oidToShortName = (oid: string): string | null => {
  const map: Record<string, string> = {
    [OID_COMMON_NAME]: "CN",
    [OID_COUNTRY]: "C",
    [OID_LOCALITY]: "L",
    [OID_STATE]: "ST",
    [OID_ORGANIZATION]: "O",
    [OID_ORGANIZATIONAL_UNIT]: "OU",
  };
  return map[oid] ?? null;
};

const formatDN = (fields: Record<string, string>): string => {
  const parts: string[] = [];
  const order = ["CN", "OU", "O", "L", "ST", "C"];
  for (const key of order) {
    const value = fields[key];
    if (value !== undefined && value !== "") parts.push(`${key}=${value}`);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!order.includes(key) && value !== "") parts.push(`${key}=${value}`);
  }
  return parts.join(", ");
};

const parseName = (
  nameNode: Asn1Node,
): Effect.Effect<Record<string, string>, SignatureKitError | Asn1Error> =>
  Effect.gen(function* () {
    const result: Record<string, string> = {};
    if (nameNode.kind !== "constructed") return result;
    for (const rdn of nameNode.children) {
      if (rdn.kind !== "constructed") continue;
      for (const atav of rdn.children) {
        if (atav.kind !== "constructed" || atav.children.length < 2) continue;
        const oidNode = atav.children[0];
        const valueNode = atav.children[1];
        if (
          oidNode === undefined ||
          oidNode.kind !== "primitive" ||
          oidNode.tag !== 0x06 ||
          valueNode === undefined
        ) {
          continue;
        }
        const oid = yield* oidString(oidNode);
        const key = oidToShortName(oid) ?? oid;
        result[key] = decodeDirectoryValue(valueNode);
      }
    }
    return result;
  });
const parseTimeWithZone = (text: string, yearDigits: 2 | 4): Date | null => {
  const utcTimePattern =
    yearDigits === 2
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/;
  const match = text.match(utcTimePattern);
  if (match === null) return null;

  const toNumber = (value: string | undefined): number | null =>
    value === undefined ? null : Number.parseInt(value, 10);

  const yearRaw = match[1];
  const monthRaw = match[2];
  const dayRaw = match[3];
  const hourRaw = match[4];
  const minuteRaw = match[5];
  const secondRaw = match[6];

  if (
    yearRaw === undefined ||
    monthRaw === undefined ||
    dayRaw === undefined ||
    hourRaw === undefined ||
    minuteRaw === undefined
  ) {
    return null;
  }

  const month = toNumber(monthRaw);
  const day = toNumber(dayRaw);
  const hour = toNumber(hourRaw);
  const minute = toNumber(minuteRaw);
  const second = secondRaw === undefined ? 0 : toNumber(secondRaw);
  if (month === null || day === null || hour === null || minute === null || second === null) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const year =
    yearDigits === 2
      ? (() => {
          const yy = toNumber(yearRaw);
          return yy === null ? null : yy >= 50 ? 1900 + yy : 2000 + yy;
        })()
      : toNumber(yearRaw);
  if (
    year === null ||
    (yearDigits === 2 && (year < 1950 || year > 2049)) ||
    (yearDigits === 4 && year < 2050)
  ) {
    return null;
  }
  const maxDay =
    month === 2
      ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  if (day > maxDay) return null;

  const base = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  return new Date(base);
};

const parseTime = (node: Asn1Node): Effect.Effect<Date, SignatureKitError> => {
  if (node.kind !== "primitive" || node.class !== "universal") {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.x509ParseFailed,
        retryable: false,
        reason: "Expected a primitive time node.",
        operation: SignatureKitOperationValue.x509Parse,
      }),
    );
  }
  const text = decodeText(node.bytes);
  const parsed =
    node.tag === 23
      ? parseTimeWithZone(text, 2)
      : node.tag === 24
        ? parseTimeWithZone(text, 4)
        : null;
  if (parsed === null) {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.x509ParseFailed,
        retryable: false,
        reason: `Unsupported time format: tag ${node.tag}.`,
        operation: SignatureKitOperationValue.x509Parse,
      }),
    );
  }
  return Effect.succeed(parsed);
};

const parseValidity = (
  node: Asn1Node,
): Effect.Effect<{ readonly notBefore: Date; readonly notAfter: Date }, SignatureKitError> =>
  Effect.gen(function* () {
    if (!isUniversalSequence(node) || node.children.length !== 2) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Invalid Validity structure.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const before = node.children[0];
    const after = node.children[1];
    if (before === undefined || after === undefined) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing validity dates.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const notBefore = yield* parseTime(before);
    const notAfter = yield* parseTime(after);
    if (notBefore.getTime() > notAfter.getTime()) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Invalid Validity interval.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    return { notBefore, notAfter };
  });

const normalizeIcpOtherName = (oid: string, value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (oid === "2.16.76.1.3.1" && digits.length >= 19) return digits.slice(8, 19);
  if (oid === "2.16.76.1.3.3" && digits.length >= 14) return digits.slice(0, 14);
  return value;
};
const parseOtherName = (
  node: Asn1Node,
): Effect.Effect<string | null, SignatureKitError | Asn1Error> =>
  Effect.gen(function* () {
    if (node.kind !== "constructed") return null;
    const oidNode = node.children[0];
    const valueWrapper = node.children[1];
    if (oidNode === undefined || oidNode.kind !== "primitive" || valueWrapper === undefined) {
      return null;
    }
    const oid = yield* oidString(oidNode);
    const label = ICP_BRASIL_OID_LABELS[oid] ?? oid;
    const inner = valueWrapper.kind === "constructed" ? valueWrapper.children[0] : valueWrapper;
    const value = inner !== undefined && inner.kind === "primitive" ? decodeText(inner.bytes) : "";
    const normalized = normalizeIcpOtherName(oid, value);
    return `${label}=${normalized === "" ? value : normalized}`;
  });

const formatIpAddress = (bytes: Uint8Array): string | null => {
  if (bytes.length === 4) return bytes.join(".");
  if (bytes.length !== 16) return null;

  const groups: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    groups.push((bytes[offset] ?? 0) * 0x100 + (bytes[offset + 1] ?? 0));
  }

  let longestZeroStart = -1;
  let longestZeroLength = 0;
  let zeroRunStart = -1;
  for (let index = 0; index < groups.length; index++) {
    if (groups[index] === 0) {
      if (zeroRunStart === -1) zeroRunStart = index;
      const zeroRunLength = index - zeroRunStart + 1;
      if (zeroRunLength > longestZeroLength) {
        longestZeroStart = zeroRunStart;
        longestZeroLength = zeroRunLength;
      }
    } else {
      zeroRunStart = -1;
    }
  }

  const formattedGroups = groups.map((group) => group.toString(16));
  if (longestZeroLength < 2) return formattedGroups.join(":");
  const before = formattedGroups.slice(0, longestZeroStart).join(":");
  const after = formattedGroups.slice(longestZeroStart + longestZeroLength).join(":");
  return `${before}::${after}`;
};

const parseGeneralName = (
  node: Asn1Node,
): Effect.Effect<string | null, SignatureKitError | Asn1Error> =>
  Effect.gen(function* () {
    if (node.class !== "context") {
      return node.kind === "primitive" ? decodeText(node.bytes) : null;
    }
    if (node.tag === 0) return yield* parseOtherName(node);
    if (node.kind === "primitive") {
      if (node.tag === 7) return formatIpAddress(node.bytes);
      if (node.tag === 8) {
        const oidNode: Asn1Node = {
          kind: "primitive",
          class: "universal",
          tag: 0x06,
          bytes: node.bytes,
        };
        return yield* oidString(oidNode);
      }
      const value = decodeText(node.bytes);
      if (value === "") return null;
      if (node.tag === 1) return `email=${value}`;
      if (node.tag === 2) return `DNS=${value}`;
      if (node.tag === 6) return `URI=${value}`;
      return value;
    }
    if (node.tag === 4) {
      const nameNode = node.children[0];
      if (nameNode === undefined) return null;
      const raw = formatDN(yield* parseName(nameNode));
      return raw === "" ? null : raw;
    }
    return null;
  });

const parseSan = (
  extensionsNode: Asn1Node,
): Effect.Effect<string | null, SignatureKitError | Asn1Error> =>
  Effect.gen(function* () {
    if (extensionsNode.kind !== "constructed") return null;
    const extsSeq = extensionsNode.children[0];
    if (extsSeq === undefined || extsSeq.kind !== "constructed") return null;

    for (const ext of extsSeq.children) {
      if (ext.kind !== "constructed" || ext.children.length < 2) continue;
      const oidNode = ext.children[0];
      const extnValue = ext.children[ext.children.length - 1];
      if (oidNode === undefined || oidNode.kind !== "primitive" || extnValue === undefined)
        continue;
      const oid = yield* oidString(oidNode);
      if (oid !== OID_SUBJECT_ALT_NAME) continue;
      if (extnValue.kind !== "primitive") continue;

      const sanSeq = yield* decode(extnValue.bytes);
      if (sanSeq.kind !== "constructed") return null;
      const names: string[] = [];
      for (const gn of sanSeq.children) {
        const value = yield* parseGeneralName(gn);
        if (value !== null) names.push(value);
      }
      return names.join(", ");
    }
    return null;
  });

const nameField = (fields: Record<string, string>, key: string): string | null => {
  const value = fields[key];
  return value === undefined || value === "" ? null : value;
};

const isUniversalSequence = (
  node: Asn1Node,
): node is Extract<Asn1Node, { readonly kind: "constructed" }> =>
  node.kind === "constructed" && node.class === "universal" && node.tag === 0x10;

export const parseX509 = (der: Uint8Array): Effect.Effect<X509Info, SignatureKitError> =>
  Effect.gen(function* () {
    const cert = yield* decode(der);
    if (!isUniversalSequence(cert) || cert.children.length < 3) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Invalid X.509 certificate: expected SEQUENCE.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const tbsCert = cert.children[0];
    if (tbsCert === undefined || !isUniversalSequence(tbsCert)) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Invalid TBSCertificate.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const tbs = tbsCert.children;
    let idx = 0;

    const version = tbs[idx];
    if (version !== undefined && version.class === "context" && version.tag === 0) {
      const versionNode =
        version.kind === "constructed" && version.children.length === 1
          ? version.children[0]
          : undefined;
      if (
        versionNode === undefined ||
        versionNode.kind !== "primitive" ||
        versionNode.class !== "universal" ||
        versionNode.tag !== 0x02 ||
        versionNode.bytes.length !== 1 ||
        versionNode.bytes[0] === undefined ||
        versionNode.bytes[0] > 2
      ) {
        return yield* Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.x509ParseFailed,
            retryable: false,
            reason: "Invalid TBSCertificate version.",
            operation: SignatureKitOperationValue.x509Parse,
          }),
        );
      }
      idx++;
    }
    const serialNode = tbs[idx];
    idx++;
    if (
      serialNode === undefined ||
      serialNode.kind !== "primitive" ||
      serialNode.class !== "universal" ||
      serialNode.tag !== 0x02
    ) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing or invalid serial number.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const serialNumber = bytesToHex(serialNode.bytes);

    idx++;

    const issuerNode = tbs[idx];
    idx++;
    if (
      issuerNode === undefined ||
      !isUniversalSequence(issuerNode) ||
      issuerNode.children.length === 0
    ) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing or invalid issuer.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const issuer = yield* parseName(issuerNode);
    if (formatDN(issuer) === "") {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing or invalid issuer.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }

    const validityNode = tbs[idx];
    idx++;
    if (validityNode === undefined) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing validity.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const validity = yield* parseValidity(validityNode);

    const subjectNode = tbs[idx];
    idx++;
    if (subjectNode === undefined) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing subject.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const subject = yield* parseName(subjectNode);

    const spkiNode = tbs[idx];
    idx++;
    if (spkiNode === undefined || !isUniversalSequence(spkiNode)) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.x509ParseFailed,
          retryable: false,
          reason: "Missing SubjectPublicKeyInfo.",
          operation: SignatureKitOperationValue.x509Parse,
        }),
      );
    }
    const publicKeyDer = encode(spkiNode);

    let subjectAltName: string | null = null;
    while (idx < tbs.length) {
      const node = tbs[idx];
      if (node !== undefined && node.class === "context" && node.tag === 3) {
        subjectAltName = yield* parseSan(node);
      }
      idx++;
    }

    return yield* Schema.decodeUnknownEffect(X509InfoSchema)({
      serialNumber,
      subject: {
        commonName: nameField(subject, "CN"),
        organization: nameField(subject, "O"),
        organizationalUnit: nameField(subject, "OU"),
        country: nameField(subject, "C"),
        state: nameField(subject, "ST"),
        locality: nameField(subject, "L"),
        raw: formatDN(subject),
      },
      issuer: {
        commonName: nameField(issuer, "CN"),
        organization: nameField(issuer, "O"),
        country: nameField(issuer, "C"),
        raw: formatDN(issuer),
      },
      validity,
      subjectAltName,
      publicKeyDer,
    }).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.x509ParseFailed,
            retryable: false,
            reason: "Invalid parsed X.509 certificate.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "X509Info",
            issueMessage: String(issue),
          }),
      ),
    );
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "Asn1Error"
        ? new SignatureKitError({
            code: SignatureKitErrorCodeValue.x509ParseFailed,
            retryable: false,
            reason: error.reason ?? error.message,
            operation: SignatureKitOperationValue.x509Parse,
          })
        : error,
    ),
  );
