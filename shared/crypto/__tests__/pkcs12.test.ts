import { webcrypto } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import { childrenOf, decode, encode, oidString } from "@signature-kit/asn1";
import type { Asn1Node } from "@signature-kit/asn1";
import { Effect, Option, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { parsePkcs12 } from "../src/pkcs12";
import { hmac } from "../src/primitives/hmac";
import { pbkdf2 } from "../src/primitives/pbkdf2";
import { sha1 } from "../src/primitives/sha1";

const PASSWORD = Redacted.make("changeit");
const LIMIT = 10_000_000;
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_ENCRYPTED_DATA = "1.2.840.113549.1.7.6";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_X509_CERT = "1.2.840.113549.1.9.22.1";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const OID_AES_128_CBC = "2.16.840.1.101.3.4.1.2";
const OID_HMAC_SHA1 = "1.2.840.113549.2.7";
const OID_HMAC_SHA256 = "1.2.840.113549.2.9";
const OID_SHA1 = "1.3.14.3.2.26";
const BOGUS_UNSUPPORTED_ALGORITHM_OID = "1.2.3.4.5.6.7.8";
const INTEGER_TAG = 0x02;
const OCTET_STRING_TAG = 0x04;
const OID_TAG = 0x06;
const SEQUENCE_TAG = 0x10;
const SET_TAG = 0x11;

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const toBufferSource = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

const integerNode = (value: number): Asn1Node => {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 0x100);
  } while (remaining > 0);
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0);
  return {
    kind: "primitive",
    class: "universal",
    tag: INTEGER_TAG,
    bytes: new Uint8Array(bytes),
  };
};

const encodeOid = (oid: string): Uint8Array => {
  const parts = oid.split(".").map((part) => Number.parseInt(part, 10));
  const encoded: number[] = [];
  const first = parts[0];
  const second = parts[1];
  if (
    first === undefined ||
    second === undefined ||
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    first > 2 ||
    second < 0
  ) {
    return new Uint8Array();
  }
  encoded.push(first * 40 + second);
  for (const part of parts.slice(2)) {
    if (!Number.isInteger(part) || part < 0) return new Uint8Array();
    const block: number[] = [];
    let remaining = part;
    do {
      block.unshift(remaining & 0x7f);
      remaining = Math.floor(remaining / 0x80);
    } while (remaining > 0);
    for (let index = 0; index < block.length - 1; index++) block[index]! |= 0x80;
    encoded.push(...block);
  }
  return new Uint8Array(encoded);
};

const primitive = (tag: number, bytes: Uint8Array): Asn1Node => ({
  kind: "primitive",
  class: "universal",
  tag,
  bytes,
});

const sequence = (children: readonly Asn1Node[]): Asn1Node => ({
  kind: "constructed",
  class: "universal",
  tag: SEQUENCE_TAG,
  children,
});

const set = (children: readonly Asn1Node[]): Asn1Node => ({
  kind: "constructed",
  class: "universal",
  tag: SET_TAG,
  children,
});

const context = (tag: number, children: readonly Asn1Node[]): Asn1Node => ({
  kind: "constructed",
  class: "context",
  tag,
  children,
});

const oid = (value: string): Asn1Node => primitive(OID_TAG, encodeOid(value));
const octetString = (bytes: Uint8Array): Asn1Node => primitive(OCTET_STRING_TAG, bytes);

const withChildren = (node: Asn1Node, children: readonly Asn1Node[]): Asn1Node =>
  node.kind === "constructed" ? { ...node, children } : node;

const unwrapContext = (node: Asn1Node): Asn1Node =>
  node.class === "context" && node.kind === "constructed" && node.children[0] !== undefined
    ? node.children[0]
    : node;

const replaceContext = (node: Asn1Node, replacement: Asn1Node): Asn1Node =>
  node.class === "context" && node.kind === "constructed" && node.children[0] !== undefined
    ? { ...node, children: [replacement] }
    : replacement;

const patchEncryptedData = (
  pfxDer: Uint8Array,
  mutateAlgorithmIdentifier: (algorithmIdentifier: Asn1Node) => Effect.Effect<Asn1Node, string>,
): Effect.Effect<Uint8Array, string> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer).pipe(Effect.mapError(() => "invalid-pfx"));
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const authSafeContainer = pfx.children[1];
    if (authSafeContainer === undefined) return yield* Effect.fail("missing-authsafe");
    const authSafeFields = yield* childrenOf(authSafeContainer).pipe(
      Effect.mapError(() => "invalid-authsafe"),
    );
    const authSafeContentContainer = authSafeFields[1];
    if (authSafeContentContainer === undefined)
      return yield* Effect.fail("missing-authsafe-content");
    const authSafeContent = unwrapContext(authSafeContentContainer);
    if (authSafeContent.kind !== "primitive") return yield* Effect.fail("invalid-authsafe-content");
    const authenticatedSafe = yield* decode(authSafeContent.bytes).pipe(
      Effect.mapError(() => "invalid-authenticated-safe"),
    );
    const safeContents = yield* childrenOf(authenticatedSafe).pipe(
      Effect.mapError(() => "invalid-safe-contents"),
    );

    let patched = false;
    const patchedContents: Asn1Node[] = [];
    for (const contentInfo of safeContents) {
      const contentInfoFields = yield* childrenOf(contentInfo).pipe(
        Effect.mapError(() => "invalid-content-info"),
      );
      const contentInfoOid = yield* oidString(
        contentInfoFields[0] ?? primitive(OID_TAG, new Uint8Array()),
      ).pipe(Effect.mapError(() => "invalid-content-info-oid"));
      if (contentInfoOid !== OID_ENCRYPTED_DATA) {
        patchedContents.push(contentInfo);
        continue;
      }
      const encryptedDataContainer = contentInfoFields[1];
      if (encryptedDataContainer === undefined) return yield* Effect.fail("missing-encrypted-data");
      const encryptedData = unwrapContext(encryptedDataContainer);
      const encryptedDataFields = yield* childrenOf(encryptedData).pipe(
        Effect.mapError(() => "invalid-encrypted-data"),
      );
      const encryptedContentInfo = encryptedDataFields[1];
      if (encryptedContentInfo === undefined)
        return yield* Effect.fail("missing-encrypted-content-info");
      const encryptedContentInfoFields = yield* childrenOf(encryptedContentInfo).pipe(
        Effect.mapError(() => "invalid-encrypted-content-info"),
      );
      const algorithmIdentifier = encryptedContentInfoFields[1];
      if (algorithmIdentifier === undefined)
        return yield* Effect.fail("missing-encryption-algorithm");
      const patchedAlgorithmIdentifier = yield* mutateAlgorithmIdentifier(algorithmIdentifier);
      const patchedEncryptedContentInfo = withChildren(
        encryptedContentInfo,
        encryptedContentInfoFields.map((field, index) =>
          index === 1 ? patchedAlgorithmIdentifier : field,
        ),
      );
      const patchedEncryptedData = withChildren(
        encryptedData,
        encryptedDataFields.map((field, index) =>
          index === 1 ? patchedEncryptedContentInfo : field,
        ),
      );
      patchedContents.push(
        withChildren(
          contentInfo,
          contentInfoFields.map((field, index) =>
            index === 1 ? replaceContext(encryptedDataContainer, patchedEncryptedData) : field,
          ),
        ),
      );
      patched = true;
    }
    if (!patched) return yield* Effect.fail("no-encrypted-data");

    const patchedAuthSafeContent = {
      ...authSafeContent,
      bytes: encode(withChildren(authenticatedSafe, patchedContents)),
    };
    const patchedAuthSafe = withChildren(
      authSafeContainer,
      authSafeFields.map((field, index) =>
        index === 1 ? replaceContext(authSafeContentContainer, patchedAuthSafeContent) : field,
      ),
    );
    return encode(
      withChildren(
        pfx,
        pfx.children.map((child, index) => (index === 1 ? patchedAuthSafe : child)),
      ),
    );
  });

const withPbkdf2Parameters = (
  pfxDer: Uint8Array,
  iterations: number,
  sha1Prf: boolean,
): Effect.Effect<Uint8Array, string> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer).pipe(Effect.mapError(() => "invalid-pfx"));
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const withoutMac = encode(withChildren(pfx, pfx.children.slice(0, 2)));
    return yield* patchEncryptedData(withoutMac, (algorithmIdentifier) =>
      Effect.gen(function* () {
        const algorithmFields = yield* childrenOf(algorithmIdentifier).pipe(
          Effect.mapError(() => "invalid-algorithm-identifier"),
        );
        const algorithmOid = yield* oidString(
          algorithmFields[0] ?? primitive(OID_TAG, new Uint8Array()),
        ).pipe(Effect.mapError(() => "invalid-algorithm-oid"));
        if (algorithmOid !== OID_PBES2) return yield* Effect.fail("not-pbes2");
        const params = algorithmFields[1];
        if (params === undefined) return yield* Effect.fail("missing-pbes2-parameters");
        const pbes2Fields = yield* childrenOf(params).pipe(
          Effect.mapError(() => "invalid-pbes2-parameters"),
        );
        const kdfInfo = pbes2Fields[0];
        if (kdfInfo === undefined) return yield* Effect.fail("missing-kdf-info");
        const kdfFields = yield* childrenOf(kdfInfo).pipe(
          Effect.mapError(() => "invalid-kdf-info"),
        );
        const kdfOid = yield* oidString(kdfFields[0] ?? primitive(OID_TAG, new Uint8Array())).pipe(
          Effect.mapError(() => "invalid-kdf-oid"),
        );
        if (kdfOid !== OID_PBKDF2) return yield* Effect.fail("not-pbkdf2");
        const kdfParams = kdfFields[1];
        if (kdfParams === undefined) return yield* Effect.fail("missing-pbkdf2-parameters");
        const kdfParameterFields = yield* childrenOf(kdfParams).pipe(
          Effect.mapError(() => "invalid-pbkdf2-parameters"),
        );

        let replacedPrf = false;
        const patchedKdfParameterFields = kdfParameterFields.map((field, index) => {
          if (index === 1) return integerNode(iterations);
          if (
            sha1Prf &&
            !replacedPrf &&
            field.class === "universal" &&
            field.kind === "constructed" &&
            field.tag === SEQUENCE_TAG
          ) {
            replacedPrf = true;
            return sequence([oid(OID_HMAC_SHA1)]);
          }
          return field;
        });
        if (sha1Prf && !replacedPrf) return yield* Effect.fail("missing-pbkdf2-prf");

        const patchedKdfInfo = withChildren(
          kdfInfo,
          kdfFields.map((field, index) =>
            index === 1 ? withChildren(kdfParams, patchedKdfParameterFields) : field,
          ),
        );
        return withChildren(
          algorithmIdentifier,
          algorithmFields.map((field, index) =>
            index === 1
              ? withChildren(
                  params,
                  pbes2Fields.map((pbes2Field, pbes2Index) =>
                    pbes2Index === 0 ? patchedKdfInfo : pbes2Field,
                  ),
                )
              : field,
          ),
        );
      }),
    );
  });

const withMacIterations = (
  pfxDer: Uint8Array,
  iterations: number,
): Effect.Effect<Uint8Array, string> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer).pipe(Effect.mapError(() => "invalid-pfx"));
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const macData = pfx.children[2];
    if (macData === undefined || macData.kind !== "constructed")
      return yield* Effect.fail("missing-mac");
    const patchedMacData = withChildren(macData, [
      ...macData.children.slice(0, 2),
      integerNode(iterations),
    ]);
    return encode(
      withChildren(
        pfx,
        pfx.children.map((child, index) => (index === 2 ? patchedMacData : child)),
      ),
    );
  });

const withOctetStringPfxVersion = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, string> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer).pipe(Effect.mapError(() => "invalid-pfx"));
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const version = pfx.children[0];
    if (version === undefined || version.kind !== "primitive")
      return yield* Effect.fail("missing-version");
    const octetVersion: Asn1Node = {
      ...version,
      class: "universal",
      tag: OCTET_STRING_TAG,
    };
    return encode(
      withChildren(
        pfx,
        pfx.children.map((child, index) => (index === 0 ? octetVersion : child)),
      ),
    );
  });

const withApplicationAuthSafeOctetString = (
  pfxDer: Uint8Array,
): Effect.Effect<Uint8Array, string> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer).pipe(Effect.mapError(() => "invalid-pfx"));
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");
    const authSafe = pfx.children[1];
    if (authSafe === undefined) return yield* Effect.fail("missing-authsafe");
    const authSafeFields = yield* childrenOf(authSafe).pipe(
      Effect.mapError(() => "invalid-authsafe"),
    );
    const contentContainer = authSafeFields[1];
    if (contentContainer === undefined || contentContainer.kind !== "constructed") {
      return yield* Effect.fail("missing-authsafe-content");
    }
    const content = contentContainer.children[0];
    if (content === undefined || content.kind !== "primitive") {
      return yield* Effect.fail("invalid-authsafe-octet-string");
    }
    const retaggedContent: Asn1Node = {
      ...content,
      class: "application",
    };
    const patchedAuthSafe = withChildren(
      authSafe,
      authSafeFields.map((field, index) =>
        index === 1 ? { ...contentContainer, children: [retaggedContent] } : field,
      ),
    );
    return encode(
      withChildren(
        pfx,
        pfx.children.map((child, index) => (index === 1 ? patchedAuthSafe : child)),
      ),
    );
  });

const contentInfoData = (data: Uint8Array): Asn1Node =>
  sequence([oid(OID_DATA), context(0, [octetString(data)])]);

const localKeyIdAttributes = (localKeyId: Uint8Array): Asn1Node =>
  set([sequence([oid(OID_LOCAL_KEY_ID), set([octetString(localKeyId)])])]);

const certificateBag = (
  localKeyId: Uint8Array | undefined,
  certificate: Uint8Array = Uint8Array.of(0x30, 0x00),
): Asn1Node =>
  sequence([
    oid(OID_CERT_BAG),
    context(0, [sequence([oid(OID_X509_CERT), context(0, [octetString(certificate)])])]),
    ...(localKeyId === undefined ? [] : [localKeyIdAttributes(localKeyId)]),
  ]);

type Pbes2Encryption = {
  readonly ciphertext: Uint8Array;
  readonly salt: Uint8Array;
  readonly iv: Uint8Array;
};

const encryptPbes2 = (plaintext: Uint8Array): Effect.Effect<Pbes2Encryption> =>
  Effect.gen(function* () {
    const salt = Uint8Array.of(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08);
    const iv = Uint8Array.of(
      0x10,
      0x11,
      0x12,
      0x13,
      0x14,
      0x15,
      0x16,
      0x17,
      0x18,
      0x19,
      0x1a,
      0x1b,
      0x1c,
      0x1d,
      0x1e,
      0x1f,
    );
    const key = pbkdf2("sha256", new TextEncoder().encode("changeit"), salt, 2, 16);
    const cryptoKey = yield* Effect.promise(() =>
      webcrypto.subtle.importKey("raw", toBufferSource(key), { name: "AES-CBC" }, false, [
        "encrypt",
      ]),
    );
    const ciphertext = new Uint8Array(
      yield* Effect.promise(() =>
        webcrypto.subtle.encrypt(
          { name: "AES-CBC", iv: toBufferSource(iv) },
          cryptoKey,
          toBufferSource(plaintext),
        ),
      ),
    );
    return { ciphertext, salt, iv };
  });

const encryptedPrivateKeyInfo = (encrypted: Pbes2Encryption, parameterIv: Uint8Array): Asn1Node =>
  sequence([
    sequence([
      oid(OID_PBES2),
      sequence([
        sequence([
          oid(OID_PBKDF2),
          sequence([octetString(encrypted.salt), integerNode(2), sequence([oid(OID_HMAC_SHA256)])]),
        ]),
        sequence([oid(OID_AES_128_CBC), octetString(parameterIv)]),
      ]),
    ]),
    octetString(encrypted.ciphertext),
  ]);

const keyBag = (privateKeyInfo: Asn1Node, localKeyId: Uint8Array | undefined): Asn1Node =>
  sequence([
    oid(OID_PKCS8_SHROUDED_KEY_BAG),
    context(0, [privateKeyInfo]),
    ...(localKeyId === undefined ? [] : [localKeyIdAttributes(localKeyId)]),
  ]);

const validPrivateKeyInfo = encode(
  sequence([integerNode(0), sequence([oid("1.2.3")]), octetString(Uint8Array.of(0x00))]),
);

const makeCustomPfx = (
  privateKeyInfo: Uint8Array,
  certificateLocalKeyId: Uint8Array,
  keyLocalKeyId: Uint8Array,
  parameterIv?: Uint8Array,
): Effect.Effect<Uint8Array> =>
  Effect.gen(function* () {
    const encrypted = yield* encryptPbes2(privateKeyInfo);
    const safeContents = encode(
      sequence([
        certificateBag(certificateLocalKeyId),
        keyBag(encryptedPrivateKeyInfo(encrypted, parameterIv ?? encrypted.iv), keyLocalKeyId),
      ]),
    );
    const authenticatedSafe = encode(sequence([contentInfoData(safeContents)]));
    return encode(sequence([integerNode(3), contentInfoData(authenticatedSafe)]));
  });

const makeCustomPfxWithCertificateBags = (
  privateKeyInfo: Uint8Array,
  certificateBags: readonly Asn1Node[],
  keyLocalKeyId: Uint8Array | undefined,
): Effect.Effect<Uint8Array> =>
  Effect.gen(function* () {
    const encrypted = yield* encryptPbes2(privateKeyInfo);
    const safeContents = encode(
      sequence([
        ...certificateBags,
        keyBag(encryptedPrivateKeyInfo(encrypted, encrypted.iv), keyLocalKeyId),
      ]),
    );
    const authenticatedSafe = encode(sequence([contentInfoData(safeContents)]));
    return encode(sequence([integerNode(3), contentInfoData(authenticatedSafe)]));
  });

const bmpPassword = (phrase: string): Uint8Array => {
  const result = new Uint8Array(phrase.length * 2 + 2);
  for (let index = 0; index < phrase.length; index++) {
    const code = phrase.charCodeAt(index);
    result[index * 2] = code >>> 8;
    result[index * 2 + 1] = code & 0xff;
  }
  return result;
};

const makeMacOnlyPfx = (macOid: string): Uint8Array => {
  const authSafeData = encode(sequence([]));
  const password = bmpPassword("changeit");
  const paddedPassword = new Uint8Array(64);
  for (let index = 0; index < paddedPassword.length; index++) {
    paddedPassword[index] = password[index % password.length]!;
  }
  const diversifier = new Uint8Array(64);
  diversifier.fill(3);
  const macKey = sha1(concatBytes([diversifier, paddedPassword]));
  const digest = hmac("sha1", macKey, authSafeData);
  const macData = sequence([
    sequence([sequence([oid(macOid)]), octetString(digest)]),
    octetString(new Uint8Array()),
  ]);
  return encode(sequence([integerNode(3), contentInfoData(authSafeData), macData]));
};

describe("parsePkcs12 hardening", () => {
  it.effect("parses supported SHA-256 MAC, PBKDF2, and AES-256 fixture paths", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const parsed = yield* parsePkcs12(pfxDer, PASSWORD);
      expect(parsed.certificate.byteLength).toBeGreaterThan(0);
      expect(parsed.privateKey.byteLength).toBeGreaterThan(0);
    }),
  );

  it.effect("preserves wrong-password classification for authenticated files", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const outcome = yield* Effect.result(parsePkcs12(pfxDer, Redacted.make("wrong-password")));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.WRONG_PASSWORD");
    }),
  );

  it.effect("rejects MAC iteration counts above the KDF limit before hashing", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withMacIterations(pfxDer, LIMIT + 1);
      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("MAC");
      }
    }),
  );

  it.effect("rejects PBKDF2 iteration counts above the KDF limit before hashing", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withPbkdf2Parameters(pfxDer, LIMIT + 1, false);
      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("PBKDF2");
      }
    }),
  );

  it.effect("rejects supported PBKDF2 work that exceeds the total per-file budget", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withPbkdf2Parameters(pfxDer, LIMIT, true);
      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("KDF work budget");
      }
    }),
  );

  it.effect("cooperatively yields while an exact-limit supported MAC KDF is running", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withMacIterations(pfxDer, LIMIT);
      const outcome = yield* Effect.promise(() =>
        Effect.runPromise(
          Effect.result(parsePkcs12(malicious, PASSWORD)).pipe(Effect.timeoutOption("50 millis")),
        ),
      );
      expect(Option.isNone(outcome)).toBe(true);
    }),
  );

  it.effect("rejects a non-INTEGER PFX version without changing authenticated bytes", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malformed = yield* withOctetStringPfxVersion(pfxDer);
      const outcome = yield* Effect.result(parsePkcs12(malformed, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.INVALID_FORMAT");
    }),
  );

  it.effect("rejects an application-tagged authSafe OCTET STRING", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malformed = yield* withApplicationAuthSafeOctetString(pfxDer);
      const outcome = yield* Effect.result(parsePkcs12(malformed, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
    }),
  );

  it.effect("accepts SHA-1 MACs and rejects unknown MAC OIDs before verification", () =>
    Effect.gen(function* () {
      const known = yield* Effect.result(parsePkcs12(makeMacOnlyPfx(OID_SHA1), PASSWORD));
      expect(Result.isFailure(known)).toBe(true);
      if (Result.isFailure(known)) expect(known.failure.code).toBe("crypto.NO_CERTIFICATE");

      const unknown = yield* Effect.result(
        parsePkcs12(makeMacOnlyPfx(BOGUS_UNSUPPORTED_ALGORITHM_OID), PASSWORD),
      );
      expect(Result.isFailure(unknown)).toBe(true);
      if (Result.isFailure(unknown))
        expect(unknown.failure.code).toBe("crypto.UNSUPPORTED_ALGORITHM");
    }),
  );

  it.effect("parses a structurally valid decrypted PKCS#8 through the supported AES path", () =>
    Effect.gen(function* () {
      const pfxDer = yield* makeCustomPfx(
        validPrivateKeyInfo,
        Uint8Array.of(0x01),
        Uint8Array.of(0x01),
      );
      const parsed = yield* parsePkcs12(pfxDer, PASSWORD);
      expect(parsed.privateKey).toEqual(validPrivateKeyInfo);
    }),
  );

  it.effect("classifies a malformed AES IV as corrupted input instead of a wrong password", () =>
    Effect.gen(function* () {
      const pfxDer = yield* makeCustomPfx(
        validPrivateKeyInfo,
        Uint8Array.of(0x01),
        Uint8Array.of(0x01),
        Uint8Array.of(0x00),
      );
      const outcome = yield* Effect.result(parsePkcs12(pfxDer, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
    }),
  );

  it.effect("rejects decrypted ASN.1 that is not a complete PKCS#8 PrivateKeyInfo", () =>
    Effect.gen(function* () {
      const pfxDer = yield* makeCustomPfx(
        Uint8Array.of(0x30, 0x00),
        Uint8Array.of(0x01),
        Uint8Array.of(0x01),
      );
      const outcome = yield* Effect.result(parsePkcs12(pfxDer, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
    }),
  );

  it.effect("rejects a present localKeyId that does not identify any certificate", () =>
    Effect.gen(function* () {
      const pfxDer = yield* makeCustomPfx(
        validPrivateKeyInfo,
        Uint8Array.of(0x01),
        Uint8Array.of(0x02),
      );
      const outcome = yield* Effect.result(parsePkcs12(pfxDer, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
    }),
  );
  it.effect("selects the localKeyId certificate and preserves the remaining chain", () =>
    Effect.gen(function* () {
      const chainCertificate = Uint8Array.of(0x30, 0x01, 0xa1);
      const endEntityCertificate = Uint8Array.of(0x30, 0x01, 0xb2);
      const pfxDer = yield* makeCustomPfxWithCertificateBags(
        validPrivateKeyInfo,
        [
          certificateBag(Uint8Array.of(0x02), chainCertificate),
          certificateBag(Uint8Array.of(0x01), endEntityCertificate),
        ],
        Uint8Array.of(0x01),
      );
      const parsed = yield* parsePkcs12(pfxDer, PASSWORD);
      expect(parsed.certificate).toEqual(endEntityCertificate);
      expect(parsed.chain).toEqual([chainCertificate]);
    }),
  );

  it.effect("rejects ambiguous certificate selection when localKeyIds are absent", () =>
    Effect.gen(function* () {
      const pfxDer = yield* makeCustomPfxWithCertificateBags(
        validPrivateKeyInfo,
        [certificateBag(undefined, Uint8Array.of(0x30, 0x01, 0xa1)), certificateBag(undefined)],
        undefined,
      );
      const outcome = yield* Effect.result(parsePkcs12(pfxDer, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
    }),
  );

  it("returns no PBKDF2 output for invalid iteration and length parameters", () => {
    const password = new TextEncoder().encode("password");
    const salt = Uint8Array.of(0x01, 0x02, 0x03);
    for (const iterations of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pbkdf2("sha256", password, salt, iterations, 16)).not.toThrow();
      expect(pbkdf2("sha256", password, salt, iterations, 16)).toEqual(new Uint8Array(0));
    }
    for (const dkLen of [
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(() => pbkdf2("sha256", password, salt, 1, dkLen)).not.toThrow();
      expect(pbkdf2("sha256", password, salt, 1, dkLen)).toEqual(new Uint8Array(0));
    }
  });
});
