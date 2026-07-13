import { ESSCertIDv2, SigningCertificateV2 } from "@peculiar/asn1-ess";
import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import { describe, expect, it } from "@effect/vitest";
import * as asn1js from "asn1js";
import { Effect, Result, Schema } from "effect";
import * as pkijs from "pkijs";
import { vi } from "vitest";
import { CmsOid, MAX_NATIVE_TIMEOUT_MILLIS, TimestampOptionsSchema } from "../src/config";
import type { TimestampOptions } from "../src/config";
import { toArrayBuffer, toBufferSource } from "../src/engine";
import { requestTimestamp } from "../src/timestamp";

type TimestampSigner = {
  readonly certificate: pkijs.Certificate;
  readonly certificateDer: Uint8Array;
  readonly privateKey: CryptoKey;
};

const TSA_TST_INFO_CONTENT_TYPE = "1.2.840.113549.1.9.16.1.4";
const TSA_TIMESTAMPING_KEY_PURPOSE_OID = "1.3.6.1.5.5.7.3.8";

const invalidTimeoutMillis: ReadonlyArray<number> = [
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  -1,
  0.5,
  2 ** 31,
];
type TsaSignerOptions = {
  readonly keyUsage?: number;
  readonly timestampingEku?: boolean;
};

type RsaHashedKeyAlgorithm = RsaHashedKeyGenParams & {
  hash: Algorithm;
};

const isRsaHashedKeyAlgorithm = (algorithm: object): algorithm is RsaHashedKeyAlgorithm =>
  "name" in algorithm &&
  algorithm.name === "RSASSA-PKCS1-v1_5" &&
  "modulusLength" in algorithm &&
  typeof algorithm.modulusLength === "number" &&
  "publicExponent" in algorithm &&
  algorithm.publicExponent instanceof Uint8Array &&
  algorithm.publicExponent.buffer instanceof ArrayBuffer &&
  "hash" in algorithm &&
  algorithm.hash !== null &&
  typeof algorithm.hash === "object" &&
  "name" in algorithm.hash &&
  typeof algorithm.hash.name === "string";

const createTsaSigner = async ({
  keyUsage,
  timestampingEku = true,
}: TsaSignerOptions = {}): Promise<TimestampSigner> => {
  const cryptoEngine = pkijs.getCrypto(true);
  const parameters = pkijs.getAlgorithmParameters("RSASSA-PKCS1-v1_5", "generateKey");
  const keyAlgorithm: RsaHashedKeyAlgorithm = isRsaHashedKeyAlgorithm(parameters.algorithm)
    ? parameters.algorithm
    : {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: toBufferSource(Uint8Array.of(1, 0, 1)),
        hash: { name: "SHA-256" },
      };
  keyAlgorithm.hash.name = "SHA-256";
  const keyPair = await cryptoEngine.generateKey(keyAlgorithm, true, parameters.usages);
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  certificate.issuer.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.BmpString({ value: "SignatureKit Test TSA" }),
    }),
  );
  certificate.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.BmpString({ value: "SignatureKit Test TSA" }),
    }),
  );
  certificate.notBefore.value = new Date("2020-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2030-01-01T00:00:00Z");
  const basicConstraints = new pkijs.BasicConstraints({ cA: true, pathLenConstraint: 0 });
  const extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: basicConstraints.toSchema().toBER(false),
      parsedValue: basicConstraints,
    }),
  ];
  if (timestampingEku) {
    const extendedKeyUsage = new pkijs.ExtKeyUsage({
      keyPurposes: [TSA_TIMESTAMPING_KEY_PURPOSE_OID],
    });
    extensions.push(
      new pkijs.Extension({
        extnID: "2.5.29.37",
        critical: true,
        extnValue: extendedKeyUsage.toSchema().toBER(false),
        parsedValue: extendedKeyUsage,
      }),
    );
  }
  if (keyUsage !== undefined) {
    const keyUsageBits = new asn1js.BitString({
      valueHex: toArrayBuffer(Uint8Array.of(keyUsage)),
    });
    extensions.push(
      new pkijs.Extension({
        extnID: "2.5.29.15",
        critical: true,
        extnValue: keyUsageBits.toBER(false),
        parsedValue: keyUsageBits,
      }),
    );
  }
  certificate.extensions = extensions;
  await certificate.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await certificate.sign(keyPair.privateKey, "SHA-256");

  return {
    certificate,
    certificateDer: new Uint8Array(certificate.toSchema(true).toBER(false)),
    privateKey: keyPair.privateKey,
  };
};

const testTsaSigner = createTsaSigner();
const unrelatedTsaSigner = createTsaSigner();
const noEkuTsaSigner = createTsaSigner({ timestampingEku: false });
const enciphermentTsaSigner = createTsaSigner({ keyUsage: 0x24 });

type TimestampResponseOptions = {
  readonly includeSignedAttributes?: boolean;
  readonly signingCertificateDers?: readonly Uint8Array[];
  readonly tamperSignature?: boolean;
};

const timestampSignedAttributes = async (
  tstInfoDer: ArrayBuffer,
  certificateDers: readonly Uint8Array[],
): Promise<pkijs.SignedAndUnsignedAttributes> => {
  const [messageDigest, certificateHashes] = await Promise.all([
    crypto.subtle.digest("SHA-256", tstInfoDer),
    Promise.all(
      certificateDers.map((certificateDer) =>
        crypto.subtle.digest("SHA-256", toArrayBuffer(certificateDer)),
      ),
    ),
  ]);
  const signingCertificate = new SigningCertificateV2({
    certs: certificateHashes.map(
      (certificateHash) => new ESSCertIDv2({ certHash: new OctetString(certificateHash) }),
    ),
  });
  return new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: CmsOid.contentType,
        values: [new asn1js.ObjectIdentifier({ value: TSA_TST_INFO_CONTENT_TYPE })],
      }),
      new pkijs.Attribute({
        type: CmsOid.messageDigest,
        values: [new asn1js.OctetString({ valueHex: messageDigest })],
      }),
      new pkijs.Attribute({
        type: CmsOid.signingCertificateV2,
        values: [asn1js.fromBER(AsnConvert.serialize(signingCertificate)).result],
      }),
    ],
  });
};

const timestampResponse = async (
  requestDer: Uint8Array,
  signer: TimestampSigner | undefined,
  options: TimestampResponseOptions = {},
): Promise<Uint8Array> => {
  const requestSchema = asn1js.fromBER(toArrayBuffer(requestDer));
  const request = new pkijs.TimeStampReq({ schema: requestSchema.result });
  const tstInfoBase = {
    version: 1,
    policy: "1.2.3.4",
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: request.messageImprint.hashAlgorithm,
      hashedMessage: request.messageImprint.hashedMessage,
    }),
    serialNumber: new asn1js.Integer({ value: 1 }),
    genTime: new Date(),
  };
  const tstInfo = new pkijs.TSTInfo(
    request.nonce === undefined ? tstInfoBase : { ...tstInfoBase, nonce: request.nonce },
  );
  const tstInfoDer = tstInfo.toSchema().toBER(false);
  const signedAttributes =
    signer === undefined || options.includeSignedAttributes === false
      ? undefined
      : await timestampSignedAttributes(
          tstInfoDer,
          options.signingCertificateDers ?? [signer.certificateDer],
        );
  const signed = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: TSA_TST_INFO_CONTENT_TYPE,
      eContent: new asn1js.OctetString({ valueHex: tstInfoDer }),
    }),
    signerInfos:
      signer === undefined
        ? []
        : [
            new pkijs.SignerInfo({
              version: 1,
              sid: new pkijs.IssuerAndSerialNumber({
                issuer: signer.certificate.issuer,
                serialNumber: signer.certificate.serialNumber,
              }),
              ...(signedAttributes === undefined ? {} : { signedAttrs: signedAttributes }),
            }),
          ],
    ...(signer === undefined ? {} : { certificates: [signer.certificate] }),
  });
  if (signer !== undefined) {
    await signed.sign(signer.privateKey, 0, "SHA-256");
    const signature = signed.signerInfos[0]?.signature.valueBlock.valueHexView;
    if (options.tamperSignature && signature !== undefined && signature.byteLength > 0) {
      signature[0] = (signature[0] ?? 0) ^ 0x01;
    }
  }
  const token = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signed.toSchema(true),
  });
  return new Uint8Array(
    new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
      timeStampToken: token,
    })
      .toSchema()
      .toBER(false),
  );
};

describe("RFC 3161 timestamps", () => {
  it.effect("requires explicit TSA trust anchors in the public schema", () =>
    Effect.gen(function* () {
      const missingTrust = yield* Effect.result(
        Schema.decodeUnknownEffect(TimestampOptionsSchema)({
          tsaUrl: "https://tsa.example.test",
          hashAlgorithm: "sha256",
        }),
      );
      const configured = yield* Schema.decodeUnknownEffect(TimestampOptionsSchema)({
        tsaUrl: "https://tsa.example.test",
        trustedRoots: [new Uint8Array([0x01])],
        hashAlgorithm: "sha256",
      });

      expect(Result.isFailure(missingTrust)).toBe(true);
      expect(configured.trustedRoots).toHaveLength(1);
    }),
  );

  it.effect("accepts only native timer-compatible timeout values in the public schema", () =>
    Effect.gen(function* () {
      const options = {
        tsaUrl: "https://tsa.example.test",
        trustedRoots: [new Uint8Array([0x01])],
        hashAlgorithm: "sha256",
      } satisfies TimestampOptions;

      for (const timeoutMillis of invalidTimeoutMillis) {
        const result = yield* Effect.result(
          Schema.decodeUnknownEffect(TimestampOptionsSchema)({ ...options, timeoutMillis }),
        );
        expect(Result.isFailure(result)).toBe(true);
      }

      const defaults = yield* Schema.decodeUnknownEffect(TimestampOptionsSchema)(options);
      const immediate = yield* Schema.decodeUnknownEffect(TimestampOptionsSchema)({
        ...options,
        timeoutMillis: 0,
      });
      const normal = yield* Schema.decodeUnknownEffect(TimestampOptionsSchema)({
        ...options,
        timeoutMillis: 25,
      });
      const maximum = yield* Schema.decodeUnknownEffect(TimestampOptionsSchema)({
        ...options,
        timeoutMillis: MAX_NATIVE_TIMEOUT_MILLIS,
      });

      expect(defaults.timeoutMillis).toBeUndefined();
      expect(immediate.timeoutMillis).toBe(0);
      expect(normal.timeoutMillis).toBe(25);
      expect(maximum.timeoutMillis).toBe(MAX_NATIVE_TIMEOUT_MILLIS);
    }),
  );

  it.effect("rejects invalid timestamp timeouts before scheduling or fetching", () =>
    Effect.gen(function* () {
      const fetch = vi.fn();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      vi.stubGlobal("fetch", fetch);

      for (const timeoutMillis of invalidTimeoutMillis) {
        const result = yield* Effect.result(
          requestTimestamp({
            data: new Uint8Array([1, 2, 3]),
            tsaUrl: "https://tsa.example.test",
            trustedRoots: [new Uint8Array([0x01])],
            hashAlgorithm: "sha256",
            timeoutMillis,
          }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
      }

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("maps timestamp nonce generation failures to CmsError", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
        throw new Error("nonce failure");
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
        expect(result.failure.operation).toBe("cms.timestamp");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks()))),
  );

  it.effect("redacts timestamp URL credentials, query, and hash from diagnostics", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.stubGlobal("fetch", () => {
        throw new Error("timestamp request failure");
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://alice:secret@tsa.example.test/path?token=secret&user=alice#fragment",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
          timeoutMillis: 1000,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
        expect(result.failure.reason).toBe("TSA request to https://tsa.example.test/path failed.");
        expect(result.failure.reason).not.toContain("alice");
        expect(result.failure.reason).not.toContain("secret");
        expect(result.failure.reason).not.toContain("token");
        expect(result.failure.reason).not.toContain("fragment");
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("clears TSA timers when fetch throws synchronously", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const removeEventListenerSpy = vi.spyOn(AbortSignal.prototype, "removeEventListener");
      vi.stubGlobal("fetch", () => {
        throw new Error("synchronous fetch failure");
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
          timeoutMillis: 1000,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(removeEventListenerSpy.mock.calls.some(([event]) => event === "abort")).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.useRealTimers();
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("rejects an unsigned RFC 3161 token", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(await timestampResponse(new Uint8Array(body), undefined)),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects trailing bytes after a TSA response", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          const response = await timestampResponse(new Uint8Array(body), signer);
          const withTrailing = new Uint8Array(response.byteLength + 1);
          withTrailing.set(response);
          return new Response(toArrayBuffer(withTrailing), {
            status: 200,
            headers: { "content-type": "application/timestamp-reply" },
          });
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
        expect(result.failure.reason).toContain("trailing bytes");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect(
    "accepts a cryptographically signed token chained to an explicit TSA trust anchor",
    () =>
      Effect.gen(function* () {
        const signer = yield* Effect.promise(() => testTsaSigner);
        vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body;
          if (body instanceof ArrayBuffer) {
            return new Response(
              toArrayBuffer(await timestampResponse(new Uint8Array(body), signer)),
              {
                status: 200,
                headers: { "content-type": "application/timestamp-reply" },
              },
            );
          }
          return new Response(new Uint8Array(), { status: 400 });
        });

        const token = yield* requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        });

        expect(token.byteLength).toBeGreaterThan(0);
      }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects a signed token whose TSA certificate has no timestamping EKU", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => noEkuTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(await timestampResponse(new Uint8Array(body), signer)),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("critical timestamping-only");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects a TSA certificate whose KeyUsage cannot sign", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => enciphermentTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(await timestampResponse(new Uint8Array(body), signer)),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("critical timestamping-only");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects a signed token without required RFC 3161 signed attributes", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(
              await timestampResponse(new Uint8Array(body), signer, {
                includeSignedAttributes: false,
              }),
            ),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toContain("signed attributes");
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect(
    "rejects a SigningCertificateV2 whose first ESSCertID names a different certificate",
    () =>
      Effect.gen(function* () {
        const signer = yield* Effect.promise(() => testTsaSigner);
        const decoySigner = yield* Effect.promise(() => unrelatedTsaSigner);
        vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body;
          if (body instanceof ArrayBuffer) {
            return new Response(
              toArrayBuffer(
                await timestampResponse(new Uint8Array(body), signer, {
                  signingCertificateDers: [decoySigner.certificateDer, signer.certificateDer],
                }),
              ),
              {
                status: 200,
                headers: { "content-type": "application/timestamp-reply" },
              },
            );
          }
          return new Response(new Uint8Array(), { status: 400 });
        });

        const result = yield* Effect.result(
          requestTimestamp({
            data: new Uint8Array([1, 2, 3]),
            tsaUrl: "https://tsa.example.test",
            trustedRoots: [signer.certificateDer],
            hashAlgorithm: "sha256",
          }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toContain("does not bind the signer certificate");
        }
      }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects a signed token that does not chain to the explicit TSA trust anchor", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      const unrelatedSigner = yield* Effect.promise(() => unrelatedTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(await timestampResponse(new Uint8Array(body), signer)),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [unrelatedSigner.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects a forged signature even when its TSA certificate is trusted", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      vi.stubGlobal("fetch", async (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof ArrayBuffer) {
          return new Response(
            toArrayBuffer(
              await timestampResponse(new Uint8Array(body), signer, { tamperSignature: true }),
            ),
            {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            },
          );
        }
        return new Response(new Uint8Array(), { status: 400 });
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("aborts an endless non-success TSA response body before reporting HTTP status", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      let aborted = false;
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                const abort = () => {
                  aborted = true;
                  controller.error(new Error("aborted"));
                };
                if (signal === null || signal === undefined) return;
                if (signal.aborted) {
                  abort();
                  return;
                }
                signal.addEventListener("abort", abort, { once: true });
              },
            }),
            { status: 503 },
          ),
        );
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toContain("HTTP 503");
      expect(aborted).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("times out a hanging TSA response body and aborts its fetch lifecycle", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => testTsaSigner);
      let aborted = false;
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                const abort = () => {
                  aborted = true;
                  controller.error(new Error("aborted"));
                };
                if (signal === null || signal === undefined) return;
                if (signal.aborted) {
                  abort();
                  return;
                }
                signal.addEventListener("abort", abort, { once: true });
              },
            }),
            { status: 200 },
          ),
        );
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [signer.certificateDer],
          hashAlgorithm: "sha256",
          timeoutMillis: 25,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
        expect(result.failure.reason).toContain("timed out");
      }
      expect(aborted).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );
});
