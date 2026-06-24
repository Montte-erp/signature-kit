/**
 * @signature-kit/certificates — X.509 and PKCS#12 certificate parsing for
 * server and browser runtimes.
 */

import { Asn1Error, decode, encode, oidString } from "@signature-kit/asn1";
import type { Asn1Node } from "@signature-kit/asn1";
import type { CryptoError } from "@signature-kit/crypto/config";
import { derToPem } from "@signature-kit/crypto/pem";
import { parsePkcs12 } from "@signature-kit/crypto/pkcs12";
import {
  CertificateIssuerSchema,
  CertificateSubjectSchema,
  CertificateValiditySchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  type BrazilianFields,
  type Certificate,
  type SignerIdentity,
} from "@signature-kit/core/config";
import { Effect, Redacted, Schema } from "effect";

const OID_COMMON_NAME = "2.5.4.3";
const OID_COUNTRY = "2.5.4.6";
const OID_LOCALITY = "2.5.4.7";
const OID_STATE = "2.5.4.8";
const OID_ORGANIZATION = "2.5.4.10";
const OID_ORGANIZATIONAL_UNIT = "2.5.4.11";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";
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

export const X509SubjectSchema = CertificateSubjectSchema;
export type X509Subject = (typeof X509SubjectSchema)["Type"];

export const X509IssuerSchema = CertificateIssuerSchema;
export type X509Issuer = (typeof X509IssuerSchema)["Type"];

export const X509InfoSchema = Schema.Struct({
  serialNumber: Schema.NonEmptyString,
  subject: X509SubjectSchema,
  issuer: X509IssuerSchema,
  validity: CertificateValiditySchema,
  subjectAltName: Schema.NullOr(Schema.String),
  publicKeyDer: Schema.Uint8Array,
});
export type X509Info = (typeof X509InfoSchema)["Type"];

export type CertificateSource = string | ArrayBuffer | ArrayBufferView;

/** Parse a `.pfx`/`.p12` container into a normalized certificate. */
export const parseCertificate = (
  source: CertificateSource,
  password: Redacted.Redacted<string>,
): Effect.Effect<Certificate, SignatureKitError> =>
  Effect.gen(function* () {
    const pfx = certificateBytes(source);
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
            reason: error.message,
            operation: SignatureKitOperationValue.pkcs12Parse,
          }),
      ),
    );
    const certPem = derToPem(pkcs12.certificate, "CERTIFICATE");
    const keyPem = derToPem(pkcs12.privateKey, "PRIVATE KEY");
    const x509 = yield* parseX509(pkcs12.certificate);
    const fingerprint = yield* digestSha256Hex(pkcs12.certificate);

    return {
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
      publicKeyDer: x509.publicKeyDer,
      privateKeyPem: Redacted.make(keyPem),
    } satisfies Certificate;
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

const cryptoErrorCode = (error: CryptoError): SignatureKitError["code"] => {
  switch (error.code) {
    case "crypto.WRONG_PASSWORD":
      return SignatureKitErrorCodeValue.wrongPassword;
    case "crypto.UNSUPPORTED_ALGORITHM":
      return SignatureKitErrorCodeValue.unsupportedAlgorithm;
    case "crypto.NO_CERTIFICATE":
      return SignatureKitErrorCodeValue.noCertificate;
    case "crypto.NO_PRIVATE_KEY":
      return SignatureKitErrorCodeValue.noPrivateKey;
    case "crypto.INVALID_FORMAT":
      return SignatureKitErrorCodeValue.invalidFormat;
    case "crypto.DECODE_ERROR":
    case "crypto.CORRUPTED_FILE":
    case "crypto.CIPHER_ERROR":
      return SignatureKitErrorCodeValue.corruptedFile;
    case "crypto.UNKNOWN":
      return SignatureKitErrorCodeValue.unknown;
  }
};

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
  }).pipe(
    Effect.map((buffer) =>
      Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ),
  );

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
  const labelled = raw.match(/CNPJ[:\s=]+(\d{14})/i);
  if (labelled?.[1] !== undefined) return labelled[1];
  const field = raw.match(/(CN|OU)\s*=\s*[^,]*?(\d{14})/);
  return field?.[2] ?? null;
};

const extractCpf = (raw: string): string | null => {
  const labelled = raw.match(/CPF[:\s=]+(\d{11})/i);
  return labelled?.[1] ?? null;
};

const failX = (reason: string): Effect.Effect<never, SignatureKitError> =>
  Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.x509ParseFailed,
      retryable: false,
      reason,
      operation: SignatureKitOperationValue.x509Parse,
    }),
  );

const fromAsn1 = <A>(effect: Effect.Effect<A, Asn1Error>): Effect.Effect<A, SignatureKitError> =>
  Effect.mapError(
    effect,
    (error) =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.x509ParseFailed,
        retryable: false,
        reason: error.message,
        operation: SignatureKitOperationValue.x509Parse,
      }),
  );

const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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

const parseName = (nameNode: Asn1Node): Effect.Effect<Record<string, string>, SignatureKitError> =>
  Effect.gen(function* () {
    const result: Record<string, string> = {};
    if (nameNode.kind !== "constructed") return result;
    for (const rdn of nameNode.children) {
      if (rdn.kind !== "constructed") continue;
      for (const atav of rdn.children) {
        if (atav.kind !== "constructed" || atav.children.length < 2) continue;
        const oidNode = atav.children[0];
        const valueNode = atav.children[1];
        if (oidNode === undefined || oidNode.kind !== "primitive") continue;
        if (valueNode === undefined || valueNode.kind !== "primitive") continue;
        const oid = yield* fromAsn1(oidString(oidNode));
        const short = oidToShortName(oid);
        if (short !== null) result[short] = decodeText(valueNode.bytes);
      }
    }
    return result;
  });

const parseTime = (node: Asn1Node): Effect.Effect<Date, SignatureKitError> => {
  if (node.kind !== "primitive") return failX("Expected a primitive time node.");
  const text = decodeText(node.bytes);
  const num = (start: number, end: number): number =>
    Number.parseInt(text.substring(start, end), 10);

  if (node.tag === 23) {
    const yy = num(0, 2);
    const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
    return Effect.succeed(
      new Date(Date.UTC(fullYear, num(2, 4) - 1, num(4, 6), num(6, 8), num(8, 10), num(10, 12))),
    );
  }
  if (node.tag === 24) {
    return Effect.succeed(
      new Date(Date.UTC(num(0, 4), num(4, 6) - 1, num(6, 8), num(8, 10), num(10, 12), num(12, 14))),
    );
  }
  return failX(`Unsupported time format: tag ${node.tag}.`);
};

const parseValidity = (
  node: Asn1Node,
): Effect.Effect<{ readonly notBefore: Date; readonly notAfter: Date }, SignatureKitError> =>
  Effect.gen(function* () {
    if (node.kind !== "constructed" || node.children.length < 2) {
      return yield* failX("Invalid Validity structure.");
    }
    const before = node.children[0];
    const after = node.children[1];
    if (before === undefined || after === undefined) return yield* failX("Missing validity dates.");
    return { notBefore: yield* parseTime(before), notAfter: yield* parseTime(after) };
  });

const normalizeIcpOtherName = (oid: string, value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (oid === "2.16.76.1.3.1" && digits.length >= 19) return digits.slice(8, 19);
  if (oid === "2.16.76.1.3.3" && digits.length >= 14) return digits.slice(0, 14);
  return value;
};

const parseOtherName = (node: Asn1Node): Effect.Effect<string | null, SignatureKitError> =>
  Effect.gen(function* () {
    if (node.kind !== "constructed") return null;
    const oidNode = node.children[0];
    const valueWrapper = node.children[1];
    if (oidNode === undefined || oidNode.kind !== "primitive" || valueWrapper === undefined) {
      return null;
    }
    const oid = yield* fromAsn1(oidString(oidNode));
    const label = ICP_BRASIL_OID_LABELS[oid] ?? oid;
    const inner = valueWrapper.kind === "constructed" ? valueWrapper.children[0] : valueWrapper;
    const value = inner !== undefined && inner.kind === "primitive" ? decodeText(inner.bytes) : "";
    const normalized = normalizeIcpOtherName(oid, value);
    return `${label}=${normalized === "" ? value : normalized}`;
  });

const parseGeneralName = (node: Asn1Node): Effect.Effect<string | null, SignatureKitError> =>
  Effect.gen(function* () {
    if (node.class !== "context") {
      return node.kind === "primitive" ? decodeText(node.bytes) : null;
    }
    if (node.tag === 0) return yield* parseOtherName(node);
    if (node.kind === "primitive") {
      const value = decodeText(node.bytes);
      if (value === "") return null;
      if (node.tag === 1) return `email=${value}`;
      if (node.tag === 2) return `DNS=${value}`;
      if (node.tag === 6) return `URI=${value}`;
      return value;
    }
    if (node.tag === 4) {
      const raw = formatDN(yield* parseName(node));
      return raw === "" ? null : raw;
    }
    return null;
  });

const parseSan = (extensionsNode: Asn1Node): Effect.Effect<string | null, SignatureKitError> =>
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
      const oid = yield* fromAsn1(oidString(oidNode));
      if (oid !== OID_SUBJECT_ALT_NAME) continue;
      if (extnValue.kind !== "primitive") continue;

      const sanSeq = yield* fromAsn1(decode(extnValue.bytes));
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

/** Parse an X.509 certificate from DER bytes. */
export const parseX509 = (der: Uint8Array): Effect.Effect<X509Info, SignatureKitError> =>
  Effect.gen(function* () {
    const cert = yield* fromAsn1(decode(der));
    if (cert.kind !== "constructed" || cert.children.length < 3) {
      return yield* failX("Invalid X.509 certificate: expected SEQUENCE.");
    }
    const tbsCert = cert.children[0];
    if (tbsCert === undefined || tbsCert.kind !== "constructed") {
      return yield* failX("Invalid TBSCertificate.");
    }
    const tbs = tbsCert.children;
    let idx = 0;

    const version = tbs[idx];
    if (version !== undefined && version.class === "context" && version.tag === 0) idx++;

    const serialNode = tbs[idx];
    idx++;
    if (serialNode === undefined || serialNode.kind !== "primitive" || serialNode.tag !== 0x02) {
      return yield* failX("Missing or invalid serial number.");
    }
    const serialNumber = bytesToHex(serialNode.bytes);

    idx++; // signature algorithm

    const issuerNode = tbs[idx];
    idx++;
    if (issuerNode === undefined) return yield* failX("Missing issuer.");
    const issuer = yield* parseName(issuerNode);

    const validityNode = tbs[idx];
    idx++;
    if (validityNode === undefined) return yield* failX("Missing validity.");
    const validity = yield* parseValidity(validityNode);

    const subjectNode = tbs[idx];
    idx++;
    if (subjectNode === undefined) return yield* failX("Missing subject.");
    const subject = yield* parseName(subjectNode);

    const spkiNode = tbs[idx];
    idx++;
    if (spkiNode === undefined) return yield* failX("Missing SubjectPublicKeyInfo.");
    const publicKeyDer = encode(spkiNode);

    let subjectAltName: string | null = null;
    while (idx < tbs.length) {
      const node = tbs[idx];
      if (node !== undefined && node.class === "context" && node.tag === 3) {
        subjectAltName = yield* parseSan(node);
      }
      idx++;
    }

    return {
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
    };
  });
