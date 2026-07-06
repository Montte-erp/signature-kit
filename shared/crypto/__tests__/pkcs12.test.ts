import { describe, expect, it } from "@effect/vitest";
import { type Asn1Node, bytesOf, childrenOf, decode, encode, oidString } from "@signature-kit/asn1";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { parsePkcs12 } from "../src/pkcs12";

const PASSWORD = Redacted.make("changeit");
const OID_ENCRYPTED_DATA = "1.2.840.113549.1.7.6";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const BOGUS_UNSUPPORTED_ALGORITHM_OID = "1.2.3.4.5.6.7.8";
const LIMIT = 10_000_000;
const INTEGER_TAG = 0x02;
const OID_TAG = 0x06;
const SEQUENCE_TAG = 0x10;

const DER_INTEGER_BYTES_LIMIT = 0xff;

const toDerInteger = (value: number): Asn1Node => {
  if (!Number.isSafeInteger(value) || value < 1) {
    return {
      kind: "primitive",
      class: "universal",
      tag: INTEGER_TAG,
      bytes: Uint8Array.of(0x00),
    };
  }

  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & DER_INTEGER_BYTES_LIMIT);
    remaining = Math.floor(remaining / 0x100);
  }

  const first = bytes[0];
  const safeBytes =
    first === undefined ? [0x00] : (first & 0x80) === 0x80 ? [0x00, ...bytes] : bytes;

  return {
    kind: "primitive",
    class: "universal",
    tag: INTEGER_TAG,
    bytes: new Uint8Array(safeBytes),
  };
};

const encodeOid = (oid: string): Uint8Array => {
  const parts = oid.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    return new Uint8Array();
  }

  const encodedParts: number[] = [];
  const first = parts[0] === undefined ? 0 : parts[0];
  const second = parts[1] === undefined ? 0 : parts[1];
  encodedParts.push(first * 40 + second);

  for (const part of parts.slice(2)) {
    let value = part;
    const block: number[] = [];
    do {
      block.unshift(value & 0x7f);
      value = value >> 7;
    } while (value > 0);
    if (block.length === 0) block.push(0x00);
    const last = block.length - 1;
    for (let i = 0; i < last; i++) {
      block[i] = block[i]! | 0x80;
    }
    encodedParts.push(...block);
  }

  return new Uint8Array(encodedParts);
};

const asn1Oid = (oid: string): Asn1Node => ({
  kind: "primitive",
  class: "universal",
  tag: OID_TAG,
  bytes: encodeOid(oid),
});

const unwrapContext = (node: Asn1Node): Asn1Node =>
  node.class === "context" && node.kind === "constructed" && node.children[0] !== undefined
    ? node.children[0]
    : node;

const replaceContext = (node: Asn1Node, replacement: Asn1Node): Asn1Node =>
  node.class === "context" && node.kind === "constructed" && node.children[0] !== undefined
    ? { ...node, children: [replacement] }
    : replacement;
const withChildren = (node: Asn1Node, children: readonly Asn1Node[]): Asn1Node =>
  node.kind === "constructed" ? { ...node, children } : node;

const patchEncryptedData = (
  pfxDer: Uint8Array,
  mutateAlgorithmIdentifier: (algorithmIdentifier: Asn1Node) => Effect.Effect<Asn1Node, unknown>,
): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer);
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");

    const authSafeContainer = pfx.children[1];
    if (authSafeContainer === undefined) return yield* Effect.fail("no-authsafe");
    const authSafeChildren = yield* childrenOf(authSafeContainer);
    if (authSafeChildren.length < 2) return yield* Effect.fail("no-authsafe-content");

    const authSafeContentContainer = authSafeChildren[1];
    if (authSafeContentContainer === undefined)
      return yield* Effect.fail("missing-authsafe-content");
    const authSafeContent = unwrapContext(authSafeContentContainer);
    const authSafeData = yield* decode(yield* bytesOf(authSafeContent));
    const safeContents = yield* childrenOf(authSafeData);

    let foundEncryptedData = false;
    const patchedSafeContents: Asn1Node[] = [];
    for (const safeContent of safeContents) {
      if (safeContent.kind !== "constructed") {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const safeContentChildren = yield* childrenOf(safeContent);
      if (safeContentChildren.length < 2) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const safeContentOidNode = safeContentChildren[0];
      if (safeContentOidNode === undefined) {
        patchedSafeContents.push(safeContent);
        continue;
      }
      const safeContentOid = yield* oidString(safeContentOidNode);
      if (safeContentOid !== OID_ENCRYPTED_DATA) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const contentInfoValue = safeContentChildren[1];
      if (contentInfoValue === undefined) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      foundEncryptedData = true;
      const encryptedData = unwrapContext(contentInfoValue);
      const encryptedChildren = yield* childrenOf(encryptedData);
      if (encryptedChildren.length < 2) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const encryptedContentInfo = encryptedChildren[1];
      if (encryptedContentInfo === undefined) {
        patchedSafeContents.push(safeContent);
        continue;
      }
      const eciChildren = yield* childrenOf(encryptedContentInfo);
      if (eciChildren.length < 2) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const algorithmIdentifier = eciChildren[1];
      if (algorithmIdentifier === undefined) {
        patchedSafeContents.push(safeContent);
        continue;
      }

      const patchedAlgorithmIdentifier = yield* mutateAlgorithmIdentifier(algorithmIdentifier);
      const patchedEciChildren = eciChildren.map((eciChild, i) =>
        i === 1 ? patchedAlgorithmIdentifier : eciChild,
      );
      const patchedEci: Asn1Node = withChildren(encryptedContentInfo, patchedEciChildren);
      const patchedEncryptedChildren = encryptedChildren.map((encryptedChild, i) =>
        i === 1 ? patchedEci : encryptedChild,
      );
      const patchedEncryptedData = withChildren(encryptedData, patchedEncryptedChildren);
      const patchedContentInfoValue = replaceContext(contentInfoValue, patchedEncryptedData);
      patchedSafeContents.push({
        ...safeContent,
        children: safeContentChildren.map((safeContentChild, i) =>
          i === 1 ? patchedContentInfoValue : safeContentChild,
        ),
      });
    }

    if (!foundEncryptedData) return yield* Effect.fail("no-encrypted-data");

    const patchedAuthSafeContent = {
      ...authSafeContent,
      bytes: encode(withChildren(authSafeData, patchedSafeContents)),
    };
    const patchedAuthSafeContentContainer = replaceContext(
      authSafeContentContainer,
      patchedAuthSafeContent,
    );
    const patchedAuthSafeChildren = authSafeChildren.map((authSafeChild, i) =>
      i === 1 ? patchedAuthSafeContentContainer : authSafeChild,
    );
    const patchedAuthSafe: Asn1Node = withChildren(authSafeContainer, patchedAuthSafeChildren);

    return encode({
      ...pfx,
      children: pfx.children.map((child, i) => (i === 1 ? patchedAuthSafe : child)),
    });
  });

const withPbkdf2IterationsInEncryptedData = (
  pfxDer: Uint8Array,
  iterations: number,
): Effect.Effect<Uint8Array, unknown> =>
  patchEncryptedData(pfxDer, (algorithmIdentifier) =>
    Effect.gen(function* () {
      const algorithmChildren = yield* childrenOf(algorithmIdentifier);
      const algorithmOidNode = algorithmChildren[0];
      if (algorithmOidNode === undefined) return yield* Effect.fail("no-algorithm-oid");
      const algorithmOid = yield* oidString(algorithmOidNode);
      if (algorithmOid !== OID_PBES2) return yield* Effect.fail("not-pbes2");

      const paramsNode = algorithmChildren[1];
      if (paramsNode === undefined) return yield* Effect.fail("no-pbes2-params");
      const pbes2Children = yield* childrenOf(paramsNode);
      const kdfInfoNode = pbes2Children[0];
      if (kdfInfoNode === undefined) return yield* Effect.fail("no-kdf-info");

      const kdfChildren = yield* childrenOf(kdfInfoNode);
      const kdfOidNode = kdfChildren[0];
      const kdfParamsNode = kdfChildren[1];
      if (kdfOidNode === undefined || kdfParamsNode === undefined)
        return yield* Effect.fail("invalid-kdf");

      const kdfOid = yield* oidString(kdfOidNode);
      if (kdfOid !== OID_PBKDF2) return yield* Effect.fail("not-pbkdf2");

      const kdfParamsChildren = yield* childrenOf(kdfParamsNode);
      if (kdfParamsChildren.length < 2) return yield* Effect.fail("invalid-pbkdf2-params");

      const patchedKdfParamsChildren = [...kdfParamsChildren];
      patchedKdfParamsChildren[1] = toDerInteger(iterations);
      const patchedKdfParams = {
        ...kdfParamsNode,
        children: patchedKdfParamsChildren,
      };
      const patchedKdfInfo = {
        ...kdfInfoNode,
        children: kdfChildren.map((kdfChild, i) => (i === 1 ? patchedKdfParams : kdfChild)),
      };
      const patchedParams = {
        ...paramsNode,
        children: pbes2Children.map((pbes2Child, i) => (i === 0 ? patchedKdfInfo : pbes2Child)),
      };
      return {
        ...algorithmIdentifier,
        children: algorithmChildren.map((algorithmChild, i) =>
          i === 1 ? patchedParams : algorithmChild,
        ),
      };
    }),
  );

const withPbeIterationsInEncryptedData = (
  pfxDer: Uint8Array,
  iterations: number,
): Effect.Effect<Uint8Array, unknown> =>
  patchEncryptedData(pfxDer, (algorithmIdentifier) =>
    Effect.gen(function* () {
      const algorithmChildren = yield* childrenOf(algorithmIdentifier);
      const paramsNode = algorithmChildren[1];
      if (paramsNode === undefined) return yield* Effect.fail("no-encrypted-data-params");

      const pbes2Children = yield* childrenOf(paramsNode);
      const kdfInfoNode = pbes2Children[0];
      if (kdfInfoNode === undefined) return yield* Effect.fail("no-pbe-kdf-node");

      const kdfChildren = yield* childrenOf(kdfInfoNode);
      const kdfParamsNode = kdfChildren[1];
      if (kdfParamsNode === undefined) return yield* Effect.fail("no-kdf-params");

      const kdfParamsChildren = yield* childrenOf(kdfParamsNode);
      const kdfSaltNode = kdfParamsChildren[0];
      if (kdfSaltNode === undefined) return yield* Effect.fail("missing-kdf-salt");

      const patchedParams: Asn1Node = {
        kind: "constructed",
        class: "universal",
        tag: SEQUENCE_TAG,
        children: [kdfSaltNode, toDerInteger(iterations)],
      };

      return {
        ...algorithmIdentifier,
        children: [asn1Oid(BOGUS_UNSUPPORTED_ALGORITHM_OID), patchedParams],
      };
    }),
  );

const stripMacData = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer);
    if (pfx.kind !== "constructed") return yield* Effect.fail("no-pfx-sequence");
    return encode({ ...pfx, children: pfx.children.slice(0, 2) });
  });

const withBoundaryPbkdf2IterationsInEncryptedData = (
  pfxDer: Uint8Array,
): Effect.Effect<Uint8Array, unknown> =>
  patchEncryptedData(pfxDer, (algorithmIdentifier) =>
    Effect.gen(function* () {
      const algorithmChildren = yield* childrenOf(algorithmIdentifier);
      const algorithmOidNode = algorithmChildren[0];
      if (algorithmOidNode === undefined) return yield* Effect.fail("no-algorithm-oid");
      const algorithmOid = yield* oidString(algorithmOidNode);
      if (algorithmOid !== OID_PBES2) return yield* Effect.fail("not-pbes2");

      const paramsNode = algorithmChildren[1];
      if (paramsNode === undefined) return yield* Effect.fail("no-pbes2-params");
      const pbes2Children = yield* childrenOf(paramsNode);
      const kdfInfoNode = pbes2Children[0];
      if (kdfInfoNode === undefined) return yield* Effect.fail("no-kdf-info");
      const encSchemeNode = pbes2Children[1];
      if (encSchemeNode === undefined) return yield* Effect.fail("no-enc-scheme");

      const kdfChildren = yield* childrenOf(kdfInfoNode);
      const kdfOidNode = kdfChildren[0];
      const kdfParamsNode = kdfChildren[1];
      if (kdfOidNode === undefined || kdfParamsNode === undefined)
        return yield* Effect.fail("invalid-kdf");

      const kdfOid = yield* oidString(kdfOidNode);
      if (kdfOid !== OID_PBKDF2) return yield* Effect.fail("not-pbkdf2");

      const kdfParamsChildren = yield* childrenOf(kdfParamsNode);
      if (kdfParamsChildren.length < 2) return yield* Effect.fail("invalid-pbkdf2-params");
      const patchedKdfParamsChildren = [...kdfParamsChildren];
      patchedKdfParamsChildren[1] = toDerInteger(LIMIT);
      const patchedKdfParams = {
        ...kdfParamsNode,
        children: patchedKdfParamsChildren,
      };
      const patchedKdfInfo = {
        ...kdfInfoNode,
        children: kdfChildren.map((kdfChild, i) => (i === 1 ? patchedKdfParams : kdfChild)),
      };

      const encSchemeChildren = yield* childrenOf(encSchemeNode);
      const patchedEncSchemeChildren = encSchemeChildren.map((encSchemeChild, i) =>
        i === 0 ? asn1Oid(BOGUS_UNSUPPORTED_ALGORITHM_OID) : encSchemeChild,
      );
      const patchedEncScheme = {
        ...encSchemeNode,
        children: patchedEncSchemeChildren,
      };

      const patchedParams = {
        ...paramsNode,
        children: pbes2Children.map((pbes2Child, i) => {
          if (i === 0) return patchedKdfInfo;
          if (i === 1) return patchedEncScheme;
          return pbes2Child;
        }),
      };

      return {
        ...algorithmIdentifier,
        children: algorithmChildren.map((algorithmChild, i) =>
          i === 1 ? patchedParams : algorithmChild,
        ),
      };
    }),
  );

const withBoundaryPbkdf2Iterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const withoutMac = yield* stripMacData(pfxDer);
    return yield* withBoundaryPbkdf2IterationsInEncryptedData(withoutMac);
  });

const withBoundaryPbeIterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const withoutMac = yield* stripMacData(pfxDer);
    return yield* withPbeIterationsInEncryptedData(withoutMac, LIMIT);
  });

const withHugePbkdf2Iterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const withoutMac = yield* stripMacData(pfxDer);
    return yield* withPbkdf2IterationsInEncryptedData(withoutMac, LIMIT + 1);
  });

const withHugePbeIterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const withoutMac = yield* stripMacData(pfxDer);
    return yield* withPbeIterationsInEncryptedData(withoutMac, LIMIT + 1);
  });

const withHugeMacIterations = (pfxDer: Uint8Array): Effect.Effect<Uint8Array, unknown> =>
  Effect.gen(function* () {
    const pfx = yield* decode(pfxDer);
    if (pfx.kind !== "constructed") return yield* Effect.fail("pfx-not-constructed");

    const macData = pfx.children[2];
    if (macData === undefined || macData.kind !== "constructed") {
      return yield* Effect.fail("no-mac-data");
    }
    const hugeIterations: Asn1Node = {
      kind: "primitive",
      class: "universal",
      tag: 0x02,
      bytes: Uint8Array.of(0x7f, 0xff, 0xff, 0xff), // 2^31 - 1
    };
    const patchedMac: Asn1Node = {
      ...macData,
      children: [...macData.children.slice(0, 2), hugeIterations],
    };
    const patchedPfx: Asn1Node = {
      ...pfx,
      children: pfx.children.map((child, index) => (index === 2 ? patchedMac : child)),
    };
    return encode(patchedPfx);
  });

describe("parsePkcs12 hardening", () => {
  it.effect("parses the untouched fixture", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const parsed = yield* parsePkcs12(pfxDer, PASSWORD);
      expect(parsed.certificate.byteLength).toBeGreaterThan(0);
      expect(parsed.privateKey.byteLength).toBeGreaterThan(0);
    }),
  );

  it.effect("rejects attacker-controlled MAC iteration counts instead of grinding the KDF", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withHugeMacIterations(pfxDer);

      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      const elapsedMs = performance.now() - started;

      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("iteration count");
      }
      expect(elapsedMs).toBeLessThan(1000);
    }),
  );

  it.effect("rejects attacker-controlled PBES2/PBKDF2 encrypted-data iteration counts", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withHugePbkdf2Iterations(pfxDer);

      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      const elapsedMs = performance.now() - started;

      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("PBKDF2");
      }
      expect(elapsedMs).toBeLessThan(1000);
    }),
  );

  it.effect("accepts boundary PBES2/PBKDF2 encrypted-data iteration count of 10_000_000", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const boundary = yield* withBoundaryPbkdf2Iterations(pfxDer);

      const outcome = yield* Effect.result(parsePkcs12(boundary, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).not.toBe("crypto.CORRUPTED_FILE");
      }
    }),
  );

  it.effect("rejects attacker-controlled legacy PBE encrypted-data iteration counts", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const malicious = yield* withHugePbeIterations(pfxDer);

      const started = performance.now();
      const outcome = yield* Effect.result(parsePkcs12(malicious, PASSWORD));
      const elapsedMs = performance.now() - started;

      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).toBe("crypto.CORRUPTED_FILE");
        expect(outcome.failure.reason).toContain("PBE");
      }
      expect(elapsedMs).toBeLessThan(1000);
    }),
  );

  it.effect("accepts boundary legacy PBE encrypted-data iteration count of 10_000_000", () =>
    Effect.gen(function* () {
      const pfxDer = yield* readA1Fixture("ecpf");
      const boundary = yield* withBoundaryPbeIterations(pfxDer);

      const outcome = yield* Effect.result(parsePkcs12(boundary, PASSWORD));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.code).not.toBe("crypto.CORRUPTED_FILE");
      }
    }),
  );
});
