import type { Asn1Error } from "@signature-kit/asn1";
import {
  type Asn1Node,
  childrenOf,
  decode,
  encode,
  integerBigInt,
  oidString,
} from "@signature-kit/asn1";
import { Effect, Redacted } from "effect";
import { CryptoError, CryptoErrorCodeValue, CryptoOperationValue } from "./config.js";
import type { Pkcs12Result } from "./config.js";
import { createHmac, hmac } from "./primitives/hmac.js";
import type { HmacHashAlgorithm } from "./primitives/hmac.js";
import { sha1 } from "./primitives/sha1.js";
import { sha256 } from "./primitives/sha256.js";
import { sha384, sha512 } from "./primitives/sha512.js";
import { aesCbcDecrypt } from "./primitives/aes.js";
import { tripleDesCbcDecrypt } from "./primitives/des.js";
import { rc2CbcDecrypt } from "./primitives/rc2.js";

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
const OID_HMAC_SHA1 = "1.2.840.113549.2.7";
const OID_HMAC_SHA256 = "1.2.840.113549.2.9";
const OID_HMAC_SHA384 = "1.2.840.113549.2.10";
const OID_HMAC_SHA512 = "1.2.840.113549.2.11";
const OID_SHA1 = "1.3.14.3.2.26";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SHA384 = "2.16.840.1.101.3.4.2.2";
const OID_SHA512 = "2.16.840.1.101.3.4.2.3";

type Pkcs12Error = CryptoError | Asn1Error;

const MAX_KDF_ITERATIONS = 10_000_000;
const MAX_KDF_WORK = 10_000_000;
const KDF_YIELD_INTERVAL = 1_024;
const kdfYield = Effect.sleep("0 millis");

type KdfBudget = { remaining: number };

const boundedIterations = (iterations: number, label: string): Effect.Effect<number, CryptoError> =>
  Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= MAX_KDF_ITERATIONS
    ? Effect.succeed(iterations)
    : Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: `Unreasonable ${label} iteration count: ${iterations}.`,
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );

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

const readOctetString = (node: Asn1Node): Effect.Effect<Uint8Array, CryptoError> => {
  if (node.class !== "universal" || node.tag !== 0x04) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `Expected universal OCTET STRING, got ${node.class} tag ${node.tag}.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  if (node.kind === "primitive") return Effect.succeed(node.bytes);
  return Effect.map(Effect.forEach(node.children, readOctetString), concatBytes);
};

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

const consumeKdfWork = (
  budget: KdfBudget,
  label: string,
  iterations: number,
  blocks: number,
): Effect.Effect<void, CryptoError> => {
  const work = iterations * blocks;
  if (!Number.isSafeInteger(work) || work > budget.remaining) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `PKCS#12 KDF work budget exceeded for ${label}: ${work} operations.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  budget.remaining -= work;
  return Effect.void;
};

const pkcs12Kdf = (
  bmpPassword: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  purpose: number,
  keyLen: number,
  algorithm: HmacHashAlgorithm,
  budget: KdfBudget,
): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.gen(function* () {
    const hashLength = hashOutputLength(algorithm);
    yield* consumeKdfWork(budget, "PKCS#12", iterations, Math.ceil(keyLen / hashLength));

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
    let hashesSinceYield = 0;

    while (resultOffset < keyLen) {
      let A = hashBytes(algorithm, DI);
      hashesSinceYield++;
      if (hashesSinceYield === KDF_YIELD_INTERVAL) {
        yield* kdfYield;
        hashesSinceYield = 0;
      }
      for (let i = 1; i < iterations; i++) {
        A = hashBytes(algorithm, A);
        hashesSinceYield++;
        if (hashesSinceYield === KDF_YIELD_INTERVAL) {
          yield* kdfYield;
          hashesSinceYield = 0;
        }
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
  });

const pbkdf2Kdf = (
  prf: HmacHashAlgorithm,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLength: number,
  budget: KdfBudget,
): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.gen(function* () {
    const hashLength = hashOutputLength(prf);
    const blockCount = Math.ceil(keyLength / hashLength);
    yield* consumeKdfWork(budget, "PBKDF2", iterations, blockCount);

    const hmacContext = createHmac(prf, password);
    const derivedKey = new Uint8Array(keyLength);
    let hashesSinceYield = 0;

    for (let blockIndex = 1; blockIndex <= blockCount; blockIndex++) {
      const saltWithIndex = new Uint8Array(salt.length + 4);
      saltWithIndex.set(salt);
      saltWithIndex[salt.length] = (blockIndex >>> 24) & 0xff;
      saltWithIndex[salt.length + 1] = (blockIndex >>> 16) & 0xff;
      saltWithIndex[salt.length + 2] = (blockIndex >>> 8) & 0xff;
      saltWithIndex[salt.length + 3] = blockIndex & 0xff;

      let u = hmacContext.compute(saltWithIndex);
      const block = new Uint8Array(u);
      hashesSinceYield++;
      if (hashesSinceYield === KDF_YIELD_INTERVAL) {
        yield* kdfYield;
        hashesSinceYield = 0;
      }

      for (let iteration = 1; iteration < iterations; iteration++) {
        u = hmacContext.compute(u);
        for (let j = 0; j < hashLength; j++) block[j]! ^= u[j]!;
        hashesSinceYield++;
        if (hashesSinceYield === KDF_YIELD_INTERVAL) {
          yield* kdfYield;
          hashesSinceYield = 0;
        }
      }

      const offset = (blockIndex - 1) * hashLength;
      derivedKey.set(block.subarray(0, Math.min(hashLength, keyLength - offset)), offset);
    }

    return derivedKey;
  });

const macHashAlgorithm = (oid: string): Effect.Effect<HmacHashAlgorithm, CryptoError> => {
  if (oid === OID_SHA1) return Effect.succeed("sha1");
  if (oid === OID_SHA256) return Effect.succeed("sha256");
  if (oid === OID_SHA384) return Effect.succeed("sha384");
  if (oid === OID_SHA512) return Effect.succeed("sha512");
  return Effect.fail(
    new CryptoError({
      code: CryptoErrorCodeValue.unsupportedAlgorithm,
      reason: `Unsupported PKCS#12 MAC hash: ${oid}`,
      operation: CryptoOperationValue.pkcs12Decode,
    }),
  );
};

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
  budget: KdfBudget,
): Effect.Effect<void, Pkcs12Error> =>
  Effect.gen(function* () {
    const macFields = yield* childrenOf(macNode);
    const digestInfo = yield* childrenOf(yield* elementAt(macFields, 0, "DigestInfo"));
    const algorithmSeq = yield* childrenOf(yield* elementAt(digestInfo, 0, "AlgorithmIdentifier"));
    const macAlgOid = yield* oidString(yield* elementAt(algorithmSeq, 0, "MAC algorithm OID"));
    const expectedDigest = yield* readOctetString(yield* elementAt(digestInfo, 1, "MAC digest"));
    const macSalt = yield* readOctetString(yield* elementAt(macFields, 1, "MAC salt"));
    const algorithm = yield* macHashAlgorithm(macAlgOid);

    const iterations = yield* boundedIterations(
      macFields.length >= 3
        ? Number(yield* integerBigInt(yield* elementAt(macFields, 2, "MAC iterations")))
        : 1,
      "MAC",
    );

    const macKey = yield* pkcs12Kdf(
      bmpPassword,
      macSalt,
      iterations,
      3,
      hashOutputLength(algorithm),
      algorithm,
      budget,
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

const pbkdf2HashAlgorithm = (oid: string): Effect.Effect<HmacHashAlgorithm, CryptoError> => {
  if (oid === OID_HMAC_SHA1) return Effect.succeed("sha1");
  if (oid === OID_HMAC_SHA256) return Effect.succeed("sha256");
  if (oid === OID_HMAC_SHA384) return Effect.succeed("sha384");
  if (oid === OID_HMAC_SHA512) return Effect.succeed("sha512");
  return Effect.fail(
    new CryptoError({
      code: CryptoErrorCodeValue.unsupportedAlgorithm,
      reason: `Unsupported PBKDF2 PRF: ${oid}`,
      operation: CryptoOperationValue.pkcs12Decode,
    }),
  );
};

const validateCbcParameters = (
  algorithm: string,
  ivLength: number,
  ciphertext: Uint8Array,
  blockSize: number,
): Effect.Effect<void, CryptoError> => {
  if (ivLength !== blockSize) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `Invalid ${algorithm} IV length: expected ${blockSize} bytes, got ${ivLength}.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  if (ciphertext.length === 0 || ciphertext.length % blockSize !== 0) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.corruptedFile,
        reason: `Invalid ${algorithm} ciphertext length: ${ciphertext.length}.`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }
  return Effect.void;
};

const decryptPbes2 = (
  encryptedData: Uint8Array,
  params: Asn1Node,
  passwordBytes: Uint8Array,
  budget: KdfBudget,
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
    const salt = yield* readOctetString(yield* elementAt(pbkdf2Params, 0, "PBKDF2 salt"));
    const iterations = yield* boundedIterations(
      Number(yield* integerBigInt(yield* elementAt(pbkdf2Params, 1, "PBKDF2 iterations"))),
      "PBKDF2",
    );

    let prf: HmacHashAlgorithm = "sha1";
    for (let i = 2; i < pbkdf2Params.length; i++) {
      const param = pbkdf2Params[i];
      if (
        param !== undefined &&
        param.class === "universal" &&
        param.kind === "constructed" &&
        param.tag === 0x10
      ) {
        const prfOid = yield* oidString(yield* elementAt(param.children, 0, "PRF OID"));
        prf = yield* pbkdf2HashAlgorithm(prfOid);
      }
    }

    const encOid = yield* oidString(yield* elementAt(encScheme, 0, "encryption OID"));
    const iv = yield* readOctetString(yield* elementAt(encScheme, 1, "encryption IV"));

    if (encOid === OID_AES_128_CBC || encOid === OID_AES_192_CBC || encOid === OID_AES_256_CBC) {
      const keyLength = encOid === OID_AES_128_CBC ? 16 : encOid === OID_AES_192_CBC ? 24 : 32;
      yield* validateCbcParameters("AES-CBC", iv.length, encryptedData, 16);
      const key = yield* pbkdf2Kdf(prf, passwordBytes, salt, iterations, keyLength, budget);
      return yield* aesCbcDecrypt(key, iv, encryptedData);
    }
    if (encOid === OID_DES_EDE3_CBC) {
      yield* validateCbcParameters("3DES-CBC", iv.length, encryptedData, 8);
      const key = yield* pbkdf2Kdf(prf, passwordBytes, salt, iterations, 24, budget);
      return yield* tripleDesCbcDecrypt(key, iv, encryptedData);
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
  budget: KdfBudget,
): Effect.Effect<Uint8Array, Pkcs12Error> => {
  if (algorithmOid === OID_PBES2) {
    return decryptPbes2(encryptedData, algorithmParams, passwordBytes, budget);
  }
  if (
    algorithmOid !== OID_PBE_SHA_3DES &&
    algorithmOid !== OID_PBE_SHA_2DES &&
    algorithmOid !== OID_PBE_SHA_RC2_128 &&
    algorithmOid !== OID_PBE_SHA_RC2_40
  ) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.unsupportedAlgorithm,
        reason: `Unsupported PBE algorithm: ${algorithmOid}`,
        operation: CryptoOperationValue.pkcs12Decode,
      }),
    );
  }

  return Effect.gen(function* () {
    const params = yield* childrenOf(algorithmParams);
    const salt = yield* readOctetString(yield* elementAt(params, 0, "PBE salt"));
    const iterations = yield* boundedIterations(
      Number(yield* integerBigInt(yield* elementAt(params, 1, "PBE iterations"))),
      "PBE",
    );

    if (algorithmOid === OID_PBE_SHA_3DES) {
      yield* validateCbcParameters("3DES-CBC", 8, encryptedData, 8);
      const key = yield* pkcs12Kdf(bmpPassword, salt, iterations, 1, 24, "sha1", budget);
      const iv = yield* pkcs12Kdf(bmpPassword, salt, iterations, 2, 8, "sha1", budget);
      return yield* tripleDesCbcDecrypt(key, iv, encryptedData);
    }
    if (algorithmOid === OID_PBE_SHA_2DES) {
      yield* validateCbcParameters("3DES-CBC", 8, encryptedData, 8);
      const key16 = yield* pkcs12Kdf(bmpPassword, salt, iterations, 1, 16, "sha1", budget);
      const key = concatBytes([key16, key16.subarray(0, 8)]);
      const iv = yield* pkcs12Kdf(bmpPassword, salt, iterations, 2, 8, "sha1", budget);
      return yield* tripleDesCbcDecrypt(key, iv, encryptedData);
    }
    if (algorithmOid === OID_PBE_SHA_RC2_128) {
      yield* validateCbcParameters("RC2-CBC", 8, encryptedData, 8);
      const key = yield* pkcs12Kdf(bmpPassword, salt, iterations, 1, 16, "sha1", budget);
      const iv = yield* pkcs12Kdf(bmpPassword, salt, iterations, 2, 8, "sha1", budget);
      return yield* rc2CbcDecrypt(key, 128, iv, encryptedData);
    }
    yield* validateCbcParameters("RC2-CBC", 8, encryptedData, 8);
    const key = yield* pkcs12Kdf(bmpPassword, salt, iterations, 1, 5, "sha1", budget);
    const iv = yield* pkcs12Kdf(bmpPassword, salt, iterations, 2, 8, "sha1", budget);
    return yield* rc2CbcDecrypt(key, 40, iv, encryptedData);
  });
};

const decryptEncryptedData = (
  node: Asn1Node,
  bmpPassword: Uint8Array,
  passwordBytes: Uint8Array,
  budget: KdfBudget,
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
        ? concatBytes(yield* Effect.forEach(encryptedContentNode.children, readOctetString))
        : encryptedContentNode.bytes;

    return yield* decryptPbe(
      encryptedContent,
      algOid,
      algParams,
      bmpPassword,
      passwordBytes,
      budget,
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
  });

type SafeBag =
  | { readonly kind: "cert"; readonly data: Uint8Array; readonly localKeyId: string | null }
  | { readonly kind: "key"; readonly data: Uint8Array; readonly localKeyId: string | null };

const bytesToHex = (bytes: Uint8Array): string => {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
};

const readLocalKeyId = (
  bagFields: readonly Asn1Node[],
): Effect.Effect<string | null, Pkcs12Error> =>
  Effect.gen(function* () {
    const attributesNode = bagFields[2];
    if (attributesNode === undefined) return null;
    if (attributesNode.kind !== "constructed") {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "PKCS#12 bag attributes are not constructed.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    let localKeyId: string | null = null;
    let hasLocalKeyId = false;
    for (const attribute of attributesNode.children) {
      if (attribute.kind !== "constructed") continue;
      const attrId = yield* oidString(yield* elementAt(attribute.children, 0, "attrId"));
      if (attrId !== OID_LOCAL_KEY_ID) continue;
      const valuesNode = attribute.children[1];
      if (
        valuesNode === undefined ||
        valuesNode.kind !== "constructed" ||
        valuesNode.children.length !== 1
      ) {
        return yield* Effect.fail(
          new CryptoError({
            code: CryptoErrorCodeValue.corruptedFile,
            reason: "PKCS#12 localKeyId attribute must contain one value.",
            operation: CryptoOperationValue.pkcs12Decode,
          }),
        );
      }
      const valueNode = valuesNode.children[0];
      if (valueNode === undefined) {
        return yield* Effect.fail(
          new CryptoError({
            code: CryptoErrorCodeValue.corruptedFile,
            reason: "PKCS#12 localKeyId attribute has no value.",
            operation: CryptoOperationValue.pkcs12Decode,
          }),
        );
      }
      if (hasLocalKeyId) {
        return yield* Effect.fail(
          new CryptoError({
            code: CryptoErrorCodeValue.corruptedFile,
            reason: "PKCS#12 bag contains multiple localKeyId attributes.",
            operation: CryptoOperationValue.pkcs12Decode,
          }),
        );
      }
      localKeyId = bytesToHex(yield* readOctetString(valueNode));
      hasLocalKeyId = true;
    }
    return localKeyId;
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

const validatePrivateKeyInfo = (pkcs8: Uint8Array): Effect.Effect<void, Pkcs12Error> =>
  Effect.gen(function* () {
    const node = yield* decode(pkcs8).pipe(
      Effect.mapError(
        (error) =>
          new CryptoError({
            code: CryptoErrorCodeValue.corruptedFile,
            reason: `Invalid decrypted PKCS#8: ${error.reason ?? error.message}`,
            operation: CryptoOperationValue.pkcs12Decode,
          }),
      ),
    );
    if (node.class !== "universal" || node.kind !== "constructed" || node.tag !== 0x10) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key is not a PKCS#8 SEQUENCE.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const fields = node.children;
    if (fields.length < 3 || fields.length > 4) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid PKCS#8 field count.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const versionNode = yield* elementAt(fields, 0, "PKCS#8 version");
    if (
      versionNode.class !== "universal" ||
      versionNode.kind !== "primitive" ||
      versionNode.tag !== 0x02 ||
      versionNode.bytes.length === 0
    ) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid PKCS#8 version.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    if ((yield* integerBigInt(versionNode)) !== 0n) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Unsupported decrypted PKCS#8 version.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const algorithmNode = yield* elementAt(fields, 1, "PKCS#8 AlgorithmIdentifier");
    if (
      algorithmNode.class !== "universal" ||
      algorithmNode.kind !== "constructed" ||
      algorithmNode.tag !== 0x10
    ) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid AlgorithmIdentifier.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    if (algorithmNode.children.length < 1 || algorithmNode.children.length > 2) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid AlgorithmIdentifier field count.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    const algorithmOid = yield* elementAt(algorithmNode.children, 0, "PKCS#8 algorithm OID");
    if (
      algorithmOid.class !== "universal" ||
      algorithmOid.kind !== "primitive" ||
      algorithmOid.tag !== 0x06
    ) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid PKCS#8 algorithm OID.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    yield* oidString(algorithmOid);

    const privateKeyNode = yield* elementAt(fields, 2, "PKCS#8 private key");
    if (privateKeyNode.class !== "universal" || privateKeyNode.tag !== 0x04) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has an invalid PKCS#8 private key field.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    yield* readOctetString(privateKeyNode);

    const attributes = fields[3];
    if (
      attributes !== undefined &&
      (attributes.class !== "context" || attributes.kind !== "constructed" || attributes.tag !== 0)
    ) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "Decrypted private key has invalid PKCS#8 attributes.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
  });

const decryptShroudedKeyBag = (
  encryptedKeyInfoDer: Uint8Array,
  bmpPassword: Uint8Array,
  passwordBytes: Uint8Array,
  budget: KdfBudget,
): Effect.Effect<Uint8Array, Pkcs12Error> =>
  Effect.gen(function* () {
    const node = yield* decode(encryptedKeyInfoDer);
    const fields = yield* childrenOf(node);
    const algSeq = yield* childrenOf(yield* elementAt(fields, 0, "AlgorithmIdentifier"));
    const algOid = yield* oidString(yield* elementAt(algSeq, 0, "algorithm OID"));
    const algParams = yield* elementAt(algSeq, 1, "algorithm parameters");
    const encryptedData = yield* readOctetString(yield* elementAt(fields, 1, "encrypted key"));

    const pkcs8 = yield* decryptPbe(
      encryptedData,
      algOid,
      algParams,
      bmpPassword,
      passwordBytes,
      budget,
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
    yield* validatePrivateKeyInfo(pkcs8);
    return pkcs8;
  });

export const parsePkcs12 = (
  data: Uint8Array,
  password: Redacted.Redacted<string>,
): Effect.Effect<Pkcs12Result, CryptoError> =>
  Effect.gen(function* () {
    const phrase = Redacted.value(password);
    const bmpPassword = toBmpString(phrase);
    const passwordBytes = new TextEncoder().encode(phrase);
    const kdfBudget: KdfBudget = { remaining: MAX_KDF_WORK };

    const pfx = yield* decode(data);
    const pfxChildren = yield* childrenOf(pfx);

    const versionNode = yield* elementAt(pfxChildren, 0, "PFX version");
    if (
      versionNode.class !== "universal" ||
      versionNode.kind !== "primitive" ||
      versionNode.tag !== 0x02
    ) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.invalidFormat,
          reason: "Expected universal INTEGER PFX version.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    const version = yield* integerBigInt(versionNode);
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
      yield* verifyMac(
        yield* elementAt(pfxChildren, 2, "MacData"),
        authSafeData,
        bmpPassword,
        kdfBudget,
      );
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
                kdfBudget,
              )
            : undefined;

      if (safeBagsDer === undefined) continue;

      const bags = yield* parseSafeBags(yield* decode(safeBagsDer));
      for (const bag of bags) {
        if (bag.kind === "cert") certificates.push({ data: bag.data, localKeyId: bag.localKeyId });
        else keyBags.push({ data: bag.data, localKeyId: bag.localKeyId });
      }
    }

    if (certificates.length === 0) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.noCertificate,
          reason: "No certificate in PKCS#12.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }
    if (keyBags.length === 0) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.noPrivateKey,
          reason: "No private key in PKCS#12.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const matchingPairs: Array<{
      readonly key: (typeof keyBags)[number];
      readonly certificate: (typeof certificates)[number];
    }> = [];
    for (const candidateKey of keyBags) {
      if (candidateKey.localKeyId === null) continue;
      let match: (typeof certificates)[number] | undefined;
      let matchCount = 0;
      for (const candidateCertificate of certificates) {
        if (candidateCertificate.localKeyId === candidateKey.localKeyId) {
          match = candidateCertificate;
          matchCount++;
        }
      }
      if (matchCount === 1 && match !== undefined) {
        matchingPairs.push({ key: candidateKey, certificate: match });
      }
    }

    let selectedPair: (typeof matchingPairs)[number] | undefined = matchingPairs[0];
    if (matchingPairs.length !== 1) selectedPair = undefined;

    const onlyKey = keyBags[0];
    const onlyCertificate = certificates[0];
    if (
      selectedPair === undefined &&
      keyBags.length === 1 &&
      certificates.length === 1 &&
      onlyKey !== undefined &&
      onlyCertificate !== undefined &&
      (onlyKey.localKeyId === null ||
        onlyCertificate.localKeyId === null ||
        onlyKey.localKeyId === onlyCertificate.localKeyId)
    ) {
      selectedPair = { key: onlyKey, certificate: onlyCertificate };
    }

    if (selectedPair === undefined) {
      return yield* Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.corruptedFile,
          reason: "PKCS#12 has no unambiguous private-key/certificate pairing.",
          operation: CryptoOperationValue.pkcs12Decode,
        }),
      );
    }

    const selectedKey = selectedPair.key;
    const selectedCertificate = selectedPair.certificate;
    const privateKey = yield* decryptShroudedKeyBag(
      selectedKey.data,
      bmpPassword,
      passwordBytes,
      kdfBudget,
    );
    const chain: Uint8Array[] = [];
    for (const entry of certificates) {
      if (entry !== selectedCertificate) chain.push(entry.data);
    }

    return {
      certificate: selectedPair.certificate.data,
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
