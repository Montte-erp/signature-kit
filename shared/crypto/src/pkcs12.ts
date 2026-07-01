/**
 * PKCS#12 (.pfx/.p12) parser — fully Effect-native.
 *
 * Navigates the ASN.1 structure with the typed `@signature-kit/asn1` accessors, so
 * every read narrows without a cast. The MAC check is the password gate; once it
 * passes, a later cipher failure is treated as a corrupt file. All failures are
 * `CryptoError` constructed at the decision point — nothing throws.
 */

import {
  type Asn1Node,
  Asn1Error,
  bytesOf,
  childrenOf,
  decode,
  encode,
  integerBigInt,
  oidString,
} from "@signature-kit/asn1";
import { Effect, Redacted } from "effect";
import {
  CryptoError,
  CryptoErrorCodeValue,
  CryptoOperationValue,
  type Pkcs12Result,
} from "./config";
import { type HmacHashAlgorithm, hmac } from "./primitives/hmac";
import { pbkdf2 } from "./primitives/pbkdf2";
import { sha1 } from "./primitives/sha1";
import { sha256 } from "./primitives/sha256";
import { sha384, sha512 } from "./primitives/sha512";
import { aesCbcDecrypt } from "./primitives/aes";
import { tripleDesCbcDecrypt } from "./primitives/des";
import { rc2CbcDecrypt } from "./primitives/rc2";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_ENCRYPTED_DATA = "1.2.840.113549.1.7.6";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_X509_CERT = "1.2.840.113549.1.9.22.1";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";
const OID_PBE_SHA_3DES = "1.2.840.113549.1.12.1.3";
const OID_PBE_SHA_2DES = "1.2.840.113549.1.12.1.4";
const OID_PBE_SHA_RC2_128 = "1.2.840.113549.1.12.1.5";
const OID_PBE_SHA_RC2_40 = "1.2.840.113549.1.12.1.6";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const OID_AES_128_CBC = "2.16.840.1.101.3.4.1.2";
const OID_AES_192_CBC = "2.16.840.1.101.3.4.1.22";
const OID_AES_256_CBC = "2.16.840.1.101.3.4.1.42";
const OID_DES_EDE3_CBC = "1.2.840.113549.3.7";
const OID_HMAC_SHA256 = "1.2.840.113549.2.9";
const OID_HMAC_SHA384 = "1.2.840.113549.2.10";
const OID_HMAC_SHA512 = "1.2.840.113549.2.11";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SHA384 = "2.16.840.1.101.3.4.2.2";
const OID_SHA512 = "2.16.840.1.101.3.4.2.3";

// =============================================================================
// Boundary helpers
// =============================================================================

type Pkcs12Error = CryptoError | Asn1Error;

const elementAt = (
  nodes: readonly Asn1Node[],
  index: number,
  label: string,
): Effect.Effect<Asn1Node, CryptoError> => {
  const node = nodes[index];
  return node === undefined
    ? Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: `Missing ${label} (element ${index}).`,
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      )
    : Effect.succeed(node);
};

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

/** Read an OCTET STRING, concatenating BER constructed fragments. */
const readOctetString = (node: Asn1Node): Effect.Effect<Uint8Array, CryptoError> => {
  if (node.tag !== 0x04) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `Expected OCTET STRING, got tag ${node.tag}.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  if (node.kind === "primitive") return Effect.succeed(node.bytes);
  return Effect.map(Effect.forEach(node.children, readOctetString), concatBytes);
};

/** Unwrap an EXPLICIT/IMPLICIT context tag. */
const unwrapContextTag = (
  node: Asn1Node,
  expectedTag: number,
): Effect.Effect<Asn1Node, Pkcs12Error> => {
  if (node.class !== "context" || node.tag !== expectedTag) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `Expected context tag [${expectedTag}], got ${node.class} tag ${node.tag}.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  if (node.kind === "constructed") {
    const first = node.children[0];
    return node.children.length === 1 && first !== undefined
      ? Effect.succeed(first)
      : Effect.succeed(node);
  }
  return decode(node.bytes);
};

// =============================================================================
// PKCS#12 KDF (RFC 7292 Appendix B) — pure, total
// =============================================================================

const hashBytes = (algorithm: HmacHashAlgorithm, data: Uint8Array): Uint8Array => {
  switch (algorithm) {
    case "sha1":
      return sha1(data);
    case "sha256":
      return sha256(data);
    case "sha384":
      return sha384(data);
    case "sha512":
      return sha512(data);
  }
};

const toBmpString = (text: string): Uint8Array => {
  if (text.length === 0) return new Uint8Array([0x00, 0x00]);
  const result = new Uint8Array(text.length * 2 + 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result[i * 2] = (code >>> 8) & 0xff;
    result[i * 2 + 1] = code & 0xff;
  }
  return result;
};

const padToMultiple = (data: Uint8Array, blockSize: number): Uint8Array => {
  if (data.length === 0) return new Uint8Array(0);
  const padded = new Uint8Array(Math.ceil(data.length / blockSize) * blockSize);
  for (let i = 0; i < padded.length; i++) {
    padded[i] = data[i % data.length]!;
  }
  return padded;
};

const hashOutputLength = (algorithm: HmacHashAlgorithm): number =>
  algorithm === "sha1" ? 20 : algorithm === "sha256" ? 32 : algorithm === "sha384" ? 48 : 64;

const pkcs12Kdf = (
  bmpPassword: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  purpose: number,
  keyLen: number,
  algorithm: HmacHashAlgorithm,
): Uint8Array => {
  const v = algorithm === "sha384" || algorithm === "sha512" ? 128 : 64;

  const D = new Uint8Array(v);
  D.fill(purpose);

  const S = padToMultiple(salt, v);
  const P = padToMultiple(bmpPassword, v);

  const I = new Uint8Array(S.length + P.length);
  I.set(S, 0);
  I.set(P, S.length);

  const DI = new Uint8Array(D.length + I.length);
  DI.set(D, 0);
  DI.set(I, D.length);

  const result = new Uint8Array(keyLen);
  let resultOffset = 0;

  while (resultOffset < keyLen) {
    let A = hashBytes(algorithm, DI);
    for (let i = 1; i < iterations; i++) {
      A = hashBytes(algorithm, A);
    }

    const toCopy = Math.min(keyLen - resultOffset, A.length);
    result.set(A.subarray(0, toCopy), resultOffset);
    resultOffset += toCopy;
    if (resultOffset >= keyLen) break;

    const B = padToMultiple(A, v);
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k]! + B[k]! + carry;
        I[j + k] = sum & 0xff;
        DI[D.length + j + k] = sum & 0xff;
        carry = sum >>> 8;
      }
    }
  }

  return result;
};

// =============================================================================
// MAC verification
// =============================================================================

const macHashAlgorithm = (oid: string): HmacHashAlgorithm =>
  oid === OID_SHA256
    ? "sha256"
    : oid === OID_SHA384
      ? "sha384"
      : oid === OID_SHA512
        ? "sha512"
        : "sha1";

const constantTimeEquals = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
};

const verifyMac = (
  macNode: Asn1Node,
  authSafeData: Uint8Array,
  bmpPassword: Uint8Array,
): Effect.Effect<void, Pkcs12Error> =>
  Effect.gen(function* () {
    const macFields = yield* childrenOf(macNode);
    const digestInfo = yield* childrenOf(yield* elementAt(macFields, 0, "DigestInfo"));
    const algorithmSeq = yield* childrenOf(yield* elementAt(digestInfo, 0, "AlgorithmIdentifier"));
    const macAlgOid = yield* oidString(yield* elementAt(algorithmSeq, 0, "MAC algorithm OID"));
    const expectedDigest = yield* bytesOf(yield* elementAt(digestInfo, 1, "MAC digest"));
    const macSalt = yield* bytesOf(yield* elementAt(macFields, 1, "MAC salt"));

    const iterations =
      macFields.length >= 3
        ? Number(yield* integerBigInt(yield* elementAt(macFields, 2, "MAC iterations")))
        : 1;

    const algorithm = macHashAlgorithm(macAlgOid);
    const macKey = pkcs12Kdf(
      bmpPassword,
      macSalt,
      iterations,
      3,
      hashOutputLength(algorithm),
      algorithm,
    );
    const computed = hmac(algorithm, macKey, authSafeData);

    if (!constantTimeEquals(computed, expectedDigest)) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.wrongPassword,
          operation: CryptoOperationValue.pkcs12Mac,
        }),
      );
    }
  });

// =============================================================================
// PBE decryption
// =============================================================================

const pbkdf2HashAlgorithm = (oid: string): HmacHashAlgorithm =>
  oid === OID_HMAC_SHA256
    ? "sha256"
    : oid === OID_HMAC_SHA384
      ? "sha384"
      : oid === OID_HMAC_SHA512
        ? "sha512"
        : "sha1";

const decryptPbes2 = (
  encryptedData: Uint8Array,
  params: Asn1Node,
  passwordBytes: Uint8Array,
): Effect.Effect<Uint8Array, Pkcs12Error> =>
  Effect.gen(function* () {
    const pbes2Params = yield* childrenOf(params);
    const kdfInfo = yield* childrenOf(yield* elementAt(pbes2Params, 0, "KeyDerivationFunc"));
    const encScheme = yield* childrenOf(yield* elementAt(pbes2Params, 1, "EncryptionScheme"));

    const kdfOid = yield* oidString(yield* elementAt(kdfInfo, 0, "KDF OID"));
    if (kdfOid !== OID_PBKDF2) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.unsupportedAlgorithm,
          reason: `Unsupported KDF: ${kdfOid}`,
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const pbkdf2Params = yield* childrenOf(yield* elementAt(kdfInfo, 1, "PBKDF2-params"));
    const salt = yield* bytesOf(yield* elementAt(pbkdf2Params, 0, "PBKDF2 salt"));
    const iterations = Number(
      yield* integerBigInt(yield* elementAt(pbkdf2Params, 1, "PBKDF2 iterations")),
    );

    let prf: HmacHashAlgorithm = "sha1";
    for (let i = 2; i < pbkdf2Params.length; i++) {
      const param = pbkdf2Params[i];
      if (param !== undefined && param.kind === "constructed" && param.tag === 0x10) {
        const prfOid = yield* oidString(yield* elementAt(param.children, 0, "PRF OID"));
        prf = pbkdf2HashAlgorithm(prfOid);
      }
    }

    const encOid = yield* oidString(yield* elementAt(encScheme, 0, "encryption OID"));
    const iv = yield* bytesOf(yield* elementAt(encScheme, 1, "encryption IV"));

    if (encOid === OID_AES_128_CBC || encOid === OID_AES_192_CBC || encOid === OID_AES_256_CBC) {
      const keyLen = encOid === OID_AES_128_CBC ? 16 : encOid === OID_AES_192_CBC ? 24 : 32;
      return yield* aesCbcDecrypt(
        pbkdf2(prf, passwordBytes, salt, iterations, keyLen),
        iv,
        encryptedData,
      );
    }
    if (encOid === OID_DES_EDE3_CBC) {
      return yield* tripleDesCbcDecrypt(
        pbkdf2(prf, passwordBytes, salt, iterations, 24),
        iv,
        encryptedData,
      );
    }
    return yield* Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.unsupportedAlgorithm,
        reason: `Unsupported encryption scheme: ${encOid}`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  });

const decryptPbe = (
  encryptedData: Uint8Array,
  algorithmOid: string,
  algorithmParams: Asn1Node,
  bmpPassword: Uint8Array,
  passwordBytes: Uint8Array,
): Effect.Effect<Uint8Array, Pkcs12Error> => {
  if (algorithmOid === OID_PBES2) {
    return decryptPbes2(encryptedData, algorithmParams, passwordBytes);
  }

  return Effect.gen(function* () {
    const params = yield* childrenOf(algorithmParams);
    const salt = yield* bytesOf(yield* elementAt(params, 0, "PBE salt"));
    const iterations = Number(yield* integerBigInt(yield* elementAt(params, 1, "PBE iterations")));
    const derive = (length: number, purpose: number): Uint8Array =>
      pkcs12Kdf(bmpPassword, salt, iterations, purpose, length, "sha1");

    if (algorithmOid === OID_PBE_SHA_3DES) {
      return yield* tripleDesCbcDecrypt(derive(24, 1), derive(8, 2), encryptedData);
    }
    if (algorithmOid === OID_PBE_SHA_2DES) {
      // 2-key 3DES: derive 16 bytes (K1||K2) and expand to the EDE key K1||K2||K1.
      const k16 = derive(16, 1);
      const key24 = concatBytes([k16, k16.subarray(0, 8)]);
      return yield* tripleDesCbcDecrypt(key24, derive(8, 2), encryptedData);
    }
    if (algorithmOid === OID_PBE_SHA_RC2_128) {
      return yield* rc2CbcDecrypt(derive(16, 1), 128, derive(8, 2), encryptedData);
    }
    if (algorithmOid === OID_PBE_SHA_RC2_40) {
      return yield* rc2CbcDecrypt(derive(5, 1), 40, derive(8, 2), encryptedData);
    }
    return yield* Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.unsupportedAlgorithm,
        reason: `Unsupported PBE algorithm: ${algorithmOid}`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  });
};

const decryptEncryptedData = (
  node: Asn1Node,
  bmpPassword: Uint8Array,
  passwordBytes: Uint8Array,
): Effect.Effect<Uint8Array, Pkcs12Error> =>
  Effect.gen(function* () {
    const edChildren = yield* childrenOf(node);
    const eci = yield* childrenOf(yield* elementAt(edChildren, 1, "EncryptedContentInfo"));
    const algSeq = yield* childrenOf(yield* elementAt(eci, 1, "AlgorithmIdentifier"));
    const algOid = yield* oidString(yield* elementAt(algSeq, 0, "algorithm OID"));
    const algParams = yield* elementAt(algSeq, 1, "algorithm parameters");

    const encryptedContentNode = yield* elementAt(eci, 2, "encrypted content");
    if (encryptedContentNode.class !== "context" || encryptedContentNode.tag !== 0) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Expected [0] IMPLICIT encrypted content.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    const encryptedContent =
      encryptedContentNode.kind === "constructed"
        ? concatBytes(
            yield* Effect.forEach(encryptedContentNode.children, (child) =>
              child.kind === "primitive" ? Effect.succeed(child.bytes) : readOctetString(child),
            ),
          )
        : encryptedContentNode.bytes;

    return yield* decryptPbe(encryptedContent, algOid, algParams, bmpPassword, passwordBytes).pipe(
      Effect.mapError((error) =>
        error.code === CryptoErrorCodeValue.cipherError
          ? new CryptoError({
              code: CryptoErrorCodeValue.wrongPassword,
              operation: CryptoOperationValue.pkcs12Decrypt,
            })
          : error,
      ),
    );
  });

// =============================================================================
// SafeBag parsing
// =============================================================================

type SafeBag =
  | { readonly kind: "cert"; readonly data: Uint8Array; readonly localKeyId: string | null }
  | { readonly kind: "key"; readonly data: Uint8Array; readonly localKeyId: string | null };

const bytesToHex = (bytes: Uint8Array): string => {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
};

/** Read the localKeyId (OID 1.2.840.113549.1.9.21) from a SafeBag's bagAttributes. */
const readLocalKeyId = (
  bagFields: readonly Asn1Node[],
): Effect.Effect<string | null, Pkcs12Error> =>
  Effect.gen(function* () {
    const attributesNode = bagFields[2];
    if (attributesNode === undefined || attributesNode.kind !== "constructed") return null;
    for (const attribute of attributesNode.children) {
      if (attribute.kind !== "constructed") continue;
      const attrId = yield* oidString(yield* elementAt(attribute.children, 0, "attrId"));
      if (attrId !== OID_LOCAL_KEY_ID) continue;
      const valuesNode = attribute.children[1];
      if (valuesNode === undefined || valuesNode.kind !== "constructed") continue;
      const valueNode = valuesNode.children[0];
      if (valueNode === undefined) continue;
      return bytesToHex(yield* bytesOf(valueNode));
    }
    return null;
  });

const extractCertFromBag = (
  certBagNode: Asn1Node,
): Effect.Effect<readonly Uint8Array[], Pkcs12Error> =>
  Effect.gen(function* () {
    const fields = yield* childrenOf(certBagNode);
    const certId = yield* oidString(yield* elementAt(fields, 0, "certId"));
    if (certId !== OID_X509_CERT) return [];
    const certValue = yield* unwrapContextTag(yield* elementAt(fields, 1, "certValue"), 0);
    return [yield* readOctetString(certValue)];
  });

const parseSafeBags = (safeContents: Asn1Node): Effect.Effect<readonly SafeBag[], Pkcs12Error> =>
  Effect.gen(function* () {
    const children = yield* childrenOf(safeContents);
    const bags: SafeBag[] = [];
    for (const bagNode of children) {
      const bagFields = yield* childrenOf(bagNode);
      const bagId = yield* oidString(yield* elementAt(bagFields, 0, "bagId"));
      const bagValue = yield* unwrapContextTag(yield* elementAt(bagFields, 1, "bagValue"), 0);
      const localKeyId = yield* readLocalKeyId(bagFields);

      if (bagId === OID_CERT_BAG) {
        const certs = yield* extractCertFromBag(bagValue);
        for (const cert of certs) bags.push({ kind: "cert", data: cert, localKeyId });
      } else if (bagId === OID_PKCS8_SHROUDED_KEY_BAG) {
        bags.push({ kind: "key", data: encode(bagValue), localKeyId });
      }
    }
    return bags;
  });

const decryptShroudedKeyBag = (
  encryptedKeyInfoDer: Uint8Array,
  bmpPassword: Uint8Array,
  passwordBytes: Uint8Array,
): Effect.Effect<Uint8Array, Pkcs12Error> =>
  Effect.gen(function* () {
    const node = yield* decode(encryptedKeyInfoDer);
    const fields = yield* childrenOf(node);
    const algSeq = yield* childrenOf(yield* elementAt(fields, 0, "AlgorithmIdentifier"));
    const algOid = yield* oidString(yield* elementAt(algSeq, 0, "algorithm OID"));
    const algParams = yield* elementAt(algSeq, 1, "algorithm parameters");
    const encryptedData = yield* bytesOf(yield* elementAt(fields, 1, "encrypted key"));

    const pkcs8 = yield* decryptPbe(
      encryptedData,
      algOid,
      algParams,
      bmpPassword,
      passwordBytes,
    ).pipe(
      Effect.mapError((error) =>
        error.code === CryptoErrorCodeValue.cipherError
          ? new CryptoError({
              code: CryptoErrorCodeValue.wrongPassword,
              operation: CryptoOperationValue.pkcs12Decrypt,
            })
          : error,
      ),
    );

    if (pkcs8[0] !== 0x30) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.wrongPassword,
          reason: "Decrypted private key is not valid PKCS#8.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    return pkcs8;
  });

// =============================================================================
// Public API
// =============================================================================

/** Parse a `.pfx`/`.p12` container, returning DER certificate + private key. */
export const parsePkcs12 = (
  data: Uint8Array,
  password: Redacted.Redacted<string>,
): Effect.Effect<Pkcs12Result, CryptoError> =>
  Effect.gen(function* () {
    const phrase = Redacted.value(password);
    const bmpPassword = toBmpString(phrase);
    const passwordBytes = new TextEncoder().encode(phrase);

    const pfx = yield* decode(data);
    const pfxChildren = yield* childrenOf(pfx);

    const version = yield* integerBigInt(yield* elementAt(pfxChildren, 0, "PFX version"));
    if (version !== 3n) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.invalidFormat,
          reason: `Unsupported PFX version: ${version}.`,
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const authSafe = yield* childrenOf(yield* elementAt(pfxChildren, 1, "authSafe ContentInfo"));
    const authSafeOid = yield* oidString(yield* elementAt(authSafe, 0, "authSafe OID"));
    if (authSafeOid !== OID_DATA) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.invalidFormat,
          reason: `Expected data ContentInfo in authSafe, got ${authSafeOid}.`,
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const authSafeContent = yield* unwrapContextTag(
      yield* elementAt(authSafe, 1, "authSafe content"),
      0,
    );
    const authSafeData = yield* readOctetString(authSafeContent);

    if (pfxChildren.length >= 3) {
      yield* verifyMac(yield* elementAt(pfxChildren, 2, "MacData"), authSafeData, bmpPassword);
    }

    const safeContents = yield* childrenOf(yield* decode(authSafeData));

    type CertEntry = { readonly data: Uint8Array; readonly localKeyId: string | null };
    const certificates: CertEntry[] = [];
    const keyBags: CertEntry[] = [];

    for (const contentInfo of safeContents) {
      const ciChildren = yield* childrenOf(contentInfo);
      const ciOid = yield* oidString(yield* elementAt(ciChildren, 0, "ContentInfo OID"));

      const safeBagsDer =
        ciOid === OID_DATA
          ? yield* readOctetString(
              yield* unwrapContextTag(yield* elementAt(ciChildren, 1, "SafeContents"), 0),
            )
          : ciOid === OID_ENCRYPTED_DATA
            ? yield* decryptEncryptedData(
                yield* unwrapContextTag(yield* elementAt(ciChildren, 1, "EncryptedData"), 0),
                bmpPassword,
                passwordBytes,
              )
            : undefined;

      if (safeBagsDer === undefined) continue;

      const bags = yield* parseSafeBags(yield* decode(safeBagsDer));
      for (const bag of bags) {
        if (bag.kind === "cert") certificates.push({ data: bag.data, localKeyId: bag.localKeyId });
        else keyBags.push({ data: bag.data, localKeyId: bag.localKeyId });
      }
    }

    const firstCert = certificates[0];
    if (firstCert === undefined) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.noCertificate,
          reason: "No certificate in PKCS#12.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    const keyBag = keyBags[0];
    if (keyBag === undefined) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.noPrivateKey,
          reason: "No private key in PKCS#12.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const privateKey = yield* decryptShroudedKeyBag(keyBag.data, bmpPassword, passwordBytes);

    // Pair the end-entity to the key by localKeyId (RFC 7292); the chain is the rest.
    // Fall back to the first cert when no localKeyId is present (the common leaf-first case).
    const matched =
      keyBag.localKeyId === null
        ? undefined
        : certificates.find((entry) => entry.localKeyId === keyBag.localKeyId);
    const endEntity = matched ?? firstCert;
    const chain = certificates.filter((entry) => entry !== endEntity).map((entry) => entry.data);

    return {
      certificate: endEntity.data,
      privateKey,
      chain,
    } satisfies Pkcs12Result;
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "Asn1Error"
        ? new CryptoError({
            code: CryptoErrorCodeValue.decodeError,
            reason: error.reason ?? error.message,
            operation: CryptoOperationValue.pkcs12Decode,
          })
        : error,
    ),
  );
