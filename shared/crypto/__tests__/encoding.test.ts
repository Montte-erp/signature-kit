import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { base64ToBytes } from "../src/base64";
import { CryptoErrorCodeValue, CryptoOperationValue } from "../src/config";
import { pemToDer } from "../src/pem";
import { aesCbcDecrypt } from "../src/primitives/aes";
import { tripleDesCbcDecrypt } from "../src/primitives/des";
import { removePkcs7Padding } from "../src/primitives/padding";
import { rc2CbcDecrypt } from "../src/primitives/rc2";

describe("crypto encoding hardening", () => {
  it.effect("decodes valid padded, unpadded, and whitespace-separated Base64", () =>
    Effect.gen(function* () {
      const cases = [
        { input: "", expected: [] },
        { input: "Zg==", expected: [0x66] },
        { input: "Zm8=", expected: [0x66, 0x6f] },
        { input: "Zm9v", expected: [0x66, 0x6f, 0x6f] },
        { input: "Zg", expected: [0x66] },
        { input: "Zm8", expected: [0x66, 0x6f] },
        { input: "\t Zm 8=\r\n", expected: [0x66, 0x6f] },
      ];

      for (const { input, expected } of cases) {
        const decoded = yield* base64ToBytes(input);
        expect(Array.from(decoded)).toEqual(expected);
      }
    }),
  );

  it.effect("rejects incomplete Base64 padding quanta", () =>
    Effect.gen(function* () {
      const malformed = ["==", "A=", "A==", "AAAA=="];

      for (const input of malformed) {
        const result = yield* Effect.result(base64ToBytes(input));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(CryptoErrorCodeValue.invalidFormat);
          expect(result.failure.operation).toBe(CryptoOperationValue.base64Decode);
        }
      }
    }),
  );

  it.effect("decodes one matching PEM envelope", () =>
    Effect.gen(function* () {
      const cases = [
        {
          input: "-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----",
          expected: [0x01, 0x02, 0x03],
        },
        {
          input: "\r\n-----BEGIN PRIVATE KEY-----\r\nAQ\r\nI=\r\n-----END PRIVATE KEY-----\r\n",
          expected: [0x01, 0x02],
        },
      ];

      for (const { input, expected } of cases) {
        const decoded = yield* pemToDer(input);
        expect(Array.from(decoded)).toEqual(expected);
      }
    }),
  );

  it.effect("rejects PEM without exactly one matching envelope", () =>
    Effect.gen(function* () {
      const malformed = [
        "AQ==",
        "-----BEGIN CERTIFICATE-----\nAQ==\n-----END PUBLIC KEY-----",
        "-----BEGIN CERTIFICATE-----\nAQ==",
        "-----END CERTIFICATE-----",
        "-----BEGIN CERTIFICATE-----\n \t\r\n-----END CERTIFICATE-----",
        [
          "-----BEGIN CERTIFICATE-----",
          "AQ==",
          "-----END CERTIFICATE-----",
          "-----BEGIN CERTIFICATE-----",
          "Ag==",
          "-----END CERTIFICATE-----",
        ].join("\n"),
      ];

      for (const input of malformed) {
        const result = yield* Effect.result(pemToDer(input));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(CryptoErrorCodeValue.invalidFormat);
          expect(result.failure.operation).toBe(CryptoOperationValue.pemDecode);
        }
      }
    }),
  );

  it.effect("removes valid PKCS#7 padding and rejects malformed padded payloads", () =>
    Effect.gen(function* () {
      const valid = [
        {
          data: Uint8Array.of(0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x02, 0x02),
          blockSize: 8,
          expected: [0x41, 0x42, 0x43, 0x44, 0x45, 0x46],
        },
        { data: new Uint8Array(16).fill(16), blockSize: 16, expected: [] },
      ];
      const malformed = [
        { data: new Uint8Array(), blockSize: 16 },
        { data: Uint8Array.of(0x41, 0x01, 0x02), blockSize: 8 },
      ];

      for (const { data, blockSize, expected } of valid) {
        const unpadded = yield* removePkcs7Padding(data, blockSize);
        expect(Array.from(unpadded)).toEqual(expected);
      }
      for (const { data, blockSize } of malformed) {
        const result = yield* Effect.result(removePkcs7Padding(data, blockSize));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(CryptoErrorCodeValue.cipherError);
        }
      }
    }),
  );

  it.effect("rejects empty CBC ciphertext for every PKCS#7 decryptor", () =>
    Effect.gen(function* () {
      const decryptors = [
        aesCbcDecrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array()),
        tripleDesCbcDecrypt(new Uint8Array(24), new Uint8Array(8), new Uint8Array()),
        rc2CbcDecrypt(new Uint8Array(16), 128, new Uint8Array(8), new Uint8Array()),
      ];

      for (const decryptor of decryptors) {
        const result = yield* Effect.result(decryptor);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(CryptoErrorCodeValue.cipherError);
        }
      }
    }),
  );
});
