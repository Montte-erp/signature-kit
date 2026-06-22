# SignatureKit crypto/asn1 port spec

Reference for the Effect-native rewrite of the crypto primitives. Every file MUST
pass `bun run check:static`. Read `AGENTS.md` for the full discipline.

## Hard rules (enforced by static checks — a violation fails the build)

- NO `throw` (no `throw new Error`, no throwing anything).
- NO value-type `as` casts (`as Foo`/`as any`/`as unknown as`). `as const` IS allowed
  (safe const-assertion — narrows to literal/readonly, cannot introduce unsoundness).
- NO bare `try`/`catch`/`finally` blocks. (`Effect.try` / `Effect.tryPromise` are fine.)
- `instanceof` only for narrowing an unknown/external cause at an adaptation boundary
  (classifying a thrown SDK error before mapping it to a tagged error).
- NO `String(error)` as the only preserved error data.
- Fallible boundaries return `Effect.Effect<A, CryptoError>`. Construct the tagged
  `CryptoError` at the decision point.
- Total pure functions (hashing, key expansion, block transforms) just return their
  value — they must simply never throw. Remove defensive guards whose precondition
  is guaranteed by the only caller (e.g. "block must be 64 bytes").
- Use `!` non-null assertions for indexed access (allowed). Never a value-type `as`
  cast (`as const` is fine).
- Import style: extensionless (`from "./sha1"`, `from "../config"`). Use
  `import type { ... }` for type-only imports (verbatimModuleSyntax is on).
- 2-space indent, double quotes, semicolons, trailing commas, printWidth 100.

## Error contract (already written — import it)

`shared/crypto/src/config.ts` exports:

```ts
export class CryptoError {
  /* TaggedErrorClass; construct: new CryptoError({ code, reason?, operation? }) */
}
export const CryptoErrorCodeValue: {
  cipherError;
  unsupportedAlgorithm;
  wrongPassword;
  noCertificate;
  noPrivateKey;
  corruptedFile;
  decodeError;
  invalidFormat;
  unknown;
};
export const CryptoOperationValue: {
  pkcs12Decode;
  pkcs12Mac;
  pkcs12Decrypt;
  cipherAes;
  cipherDes;
  cipherRc2;
};
export type Pkcs12Result = {
  readonly certificate: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly chain: readonly Uint8Array[];
};
```

## Files to produce (port from the dfekit source, applying the rules)

Source root: `/home/yorizel/Documents/fot-libraries/libraries/crypto/src/primitives/`
Target root: `shared/crypto/src/primitives/`

### Total primitives (return values, never throw — remove throw guards)

- `sha1.ts` — port `sha1.ts`. Export `sha1(data: Uint8Array): Uint8Array`.
- `sha256.ts` — port `sha256.ts`. Export `sha256(data: Uint8Array): Uint8Array`,
  `sha256WithState(initState: Uint32Array, data: Uint8Array, prefixLen: number): Uint8Array`,
  `sha256ProcessBlock(block: Uint8Array): Uint32Array` (DROP the length-guard throw).
- `sha512.ts` — port `sha512.ts`. Export `sha512(data: Uint8Array): Uint8Array`,
  `sha384(data: Uint8Array): Uint8Array`.
- `hmac.ts` — port `hmac.ts`. Exports `type HmacHashAlgorithm = "sha1" | "sha256" | "sha384" | "sha512"`,
  `hmac(alg: HmacHashAlgorithm, key: Uint8Array, data: Uint8Array): Uint8Array`,
  `createHmac(alg: HmacHashAlgorithm, key: Uint8Array): { compute(data: Uint8Array): Uint8Array }`.
  Imports from `./sha1`, `./sha256`, `./sha512`.
- `pbkdf2.ts` — port `pbkdf2.ts`. Export
  `pbkdf2(prf: HmacHashAlgorithm, password: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number): Uint8Array`.
  DROP the `iterations < 1` / `dkLen < 1` throw guards. `password` MUST be `Uint8Array`
  only (NOT `string | Uint8Array` — a `password: string` param fails the secret check).
  Imports `createHmac`, `hmac`, `type HmacHashAlgorithm` from `./hmac`.

### Padding helper (fallible)

- `padding.ts` — Export
  `removePkcs7Padding(data: Uint8Array, blockSize: number): Effect.Effect<Uint8Array, CryptoError>`.
  Validates the PKCS#7 padding; on invalid padding fail with
  `new CryptoError({ code: CryptoErrorCodeValue.cipherError, reason: "Invalid PKCS#7 padding." })`.
  Use `.subarray(0, data.length - pad)` for the success value. Import `Effect` from `"effect"`
  and `CryptoError`, `CryptoErrorCodeValue` from `"../config"`.

### Ciphers (fallible — return Effect)

Each: validate key/iv/blocklength → if invalid, `Effect.fail(new CryptoError({ code: cipherError, reason, operation }))`.
Do the block math in a PURE internal helper (returns the padded plaintext `Uint8Array`,
never throws), then `Effect.flatMap` into `removePkcs7Padding(raw, blockSize)`.

- `aes.ts` — port `aes.ts`. Export
  `aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Effect.Effect<Uint8Array, CryptoError>`.
  blockSize 16. operation `CryptoOperationValue.cipherAes`. Keep S-boxes/round logic identical.
- `des.ts` — port `des.ts`. Export
  `tripleDesCbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Effect.Effect<Uint8Array, CryptoError>`.
  blockSize 8. operation `CryptoOperationValue.cipherDes`. Keep DES tables/Feistel identical.
- `rc2.ts` — port `rc2.ts`. Export
  `rc2CbcDecrypt(key: Uint8Array, effectiveBits: number, iv: Uint8Array, ciphertext: Uint8Array): Effect.Effect<Uint8Array, CryptoError>`.
  blockSize 8. operation `CryptoOperationValue.cipherRc2`. Keep PITABLE/round logic identical.
  Note: original `kw(K, i)` used `K[i] as number` — replace with `K[i]!` (no `as`).

### PEM + hash (total)

- `pem.ts` — Export `pemToDer(pem: string): Uint8Array` and
  `derToPem(der: Uint8Array, label: string): string`. Use `Buffer.from(b64, "base64")`
  (lenient, never throws) for decode and `Buffer.from(der).toString("base64")` for encode.
  No throw, no `as`.
- `hash.ts` — Export `hash(algorithm: HashAlgorithm, data: Uint8Array): Uint8Array` where
  `type HashAlgorithm = "sha256" | "sha384" | "sha512"`. Dispatch to `./primitives/sha256`
  and `./primitives/sha512`.

## Verification

After writing, the file must satisfy: no `throw`, no value-type `as` cast, no library `try`/`catch`.
The integrator runs `bun run check:static` and `tsc -b`.
