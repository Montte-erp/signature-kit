import * as asn1js from "asn1js";
import { Effect, Schema } from "effect";
import * as pkijs from "pkijs";
import {
  CmsError,
  CmsErrorCodeValue,
  CmsHashAlgorithmSchema,
  CmsOid,
  CmsOperationValue,
  hashAlgorithmOid,
  TimeoutMillisSchema,
} from "./config.js";
import { digest } from "./engine.js";

const TSA_CONTENT_TYPE = "application/timestamp-query";
const TSA_TST_INFO_CONTENT_TYPE = "1.2.840.113549.1.9.16.1.4";
const TSA_EXTENDED_KEY_USAGE_OID = "2.5.29.37";
const TSA_TIMESTAMPING_KEY_PURPOSE_OID = "1.3.6.1.5.5.7.3.8";
const TSA_SIGNING_CERTIFICATE_OID = "1.2.840.113549.1.9.16.2.12";
const TSA_KEY_USAGE_OID = "2.5.29.15";
const DEFAULT_TIMEOUT_MILLIS = 15000;
const diagnosticTimestampUrl = (url: string): string =>
  url.replace(/^([a-z][a-z\d+.-]*:\/\/)(?:[^/?#]*@)/i, "$1").replace(/[?#].*$/, "");

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

type EssHashAlgorithm = "sha1" | "sha256" | "sha384" | "sha512";

type EssCertIdV2Hash = {
  readonly algorithm: EssHashAlgorithm;
  readonly hash: Uint8Array;
};

const sequenceChildren = (value: unknown): readonly unknown[] | undefined =>
  value instanceof asn1js.Sequence ? value.valueBlock.value : undefined;

const octetStringBytes = (value: unknown): Uint8Array | undefined => {
  if (!(value instanceof asn1js.OctetString)) return undefined;
  return value.valueBlock.valueHexView.byteLength === 0
    ? new Uint8Array(value.getValue())
    : value.valueBlock.valueHexView;
};

const essHashAlgorithmFromOid = (oid: string): EssHashAlgorithm | undefined => {
  switch (oid) {
    case "1.3.14.3.2.26":
      return "sha1";
    case "2.16.840.1.101.3.4.2.1":
      return "sha256";
    case "2.16.840.1.101.3.4.2.2":
      return "sha384";
    case "2.16.840.1.101.3.4.2.3":
      return "sha512";
    default:
      return undefined;
  }
};

const essHashAlgorithmIdentifier = (value: unknown): EssHashAlgorithm | undefined => {
  const fields = sequenceChildren(value);
  if (fields === undefined || fields.length < 1 || fields.length > 2) return undefined;
  const algorithm = fields[0];
  const parameters = fields[1];
  if (!(algorithm instanceof asn1js.ObjectIdentifier)) return undefined;
  if (parameters !== undefined && !(parameters instanceof asn1js.Null)) return undefined;
  return essHashAlgorithmFromOid(algorithm.valueBlock.toString());
};

const essCertIdV2Hash = (value: unknown): EssCertIdV2Hash | undefined => {
  const fields = sequenceChildren(value);
  if (fields === undefined || fields.length === 0 || fields.length > 3) return undefined;
  const defaultHash = octetStringBytes(fields[0]);
  if (defaultHash !== undefined) return { algorithm: "sha256", hash: defaultHash };
  const algorithm = essHashAlgorithmIdentifier(fields[0]);
  const hash = octetStringBytes(fields[1]);
  return algorithm === undefined || hash === undefined ? undefined : { algorithm, hash };
};

const timestampSigningCertificateAttribute = (
  signed: pkijs.SignedData,
): pkijs.Attribute | undefined => {
  const signedAttributes = signed.signerInfos[0]?.signedAttrs;
  if (signedAttributes === undefined || signedAttributes.type !== 0) return undefined;
  const contentTypeAttributes = signedAttributes.attributes.filter(
    (attribute) => attribute.type === CmsOid.contentType,
  );
  const messageDigestAttributes = signedAttributes.attributes.filter(
    (attribute) => attribute.type === CmsOid.messageDigest,
  );
  const contentType = contentTypeAttributes.length === 1 ? contentTypeAttributes[0] : undefined;
  const messageDigest =
    messageDigestAttributes.length === 1 ? messageDigestAttributes[0] : undefined;
  if (
    contentType === undefined ||
    contentType.values.length !== 1 ||
    !(contentType.values[0] instanceof asn1js.ObjectIdentifier) ||
    contentType.values[0].valueBlock.toString() !== TSA_TST_INFO_CONTENT_TYPE ||
    messageDigest === undefined ||
    messageDigest.values.length !== 1
  ) {
    return undefined;
  }
  const messageDigestBytes = octetStringBytes(messageDigest.values[0]);
  if (messageDigestBytes === undefined || messageDigestBytes.byteLength === 0) return undefined;
  const signingCertificate = signedAttributes.attributes.filter(
    (attribute) =>
      attribute.type === TSA_SIGNING_CERTIFICATE_OID ||
      attribute.type === CmsOid.signingCertificateV2,
  );
  if (signingCertificate.length !== 1) return undefined;
  const attribute = signingCertificate[0];
  return attribute === undefined || attribute.values.length !== 1 ? undefined : attribute;
};

const isTimestampAuthorityCertificate = (certificate: pkijs.Certificate): boolean => {
  const extendedKeyUsage = certificate.extensions?.filter(
    (extension) => extension.extnID === TSA_EXTENDED_KEY_USAGE_OID,
  );
  const extendedKeyUsageExtension = extendedKeyUsage?.[0];
  const keyUsage = certificate.extensions?.filter(
    (extension) => extension.extnID === TSA_KEY_USAGE_OID,
  );
  const keyUsageExtension = keyUsage?.[0];
  const keyUsagePermitsSigning =
    keyUsage === undefined ||
    keyUsage.length === 0 ||
    (keyUsage.length === 1 &&
      keyUsageExtension?.parsedValue instanceof asn1js.BitString &&
      ((keyUsageExtension.parsedValue.valueBlock.valueHexView[0] ?? 0) & 0xc0) !== 0);
  return (
    extendedKeyUsage?.length === 1 &&
    extendedKeyUsageExtension?.critical === true &&
    extendedKeyUsageExtension.parsedValue instanceof pkijs.ExtKeyUsage &&
    extendedKeyUsageExtension.parsedValue.keyPurposes.length === 1 &&
    extendedKeyUsageExtension.parsedValue.keyPurposes[0] === TSA_TIMESTAMPING_KEY_PURPOSE_OID &&
    keyUsagePermitsSigning
  );
};

const signingCertificateMatches = (
  attribute: pkijs.Attribute,
  certificateDer: Uint8Array,
): Effect.Effect<boolean, CmsError> =>
  Effect.gen(function* () {
    const value = attribute.values[0];
    if (value === undefined) return false;
    const signingCertificate = sequenceChildren(value);
    const certificateEntries =
      signingCertificate === undefined ? undefined : sequenceChildren(signingCertificate[0]);
    const certificateEntry = certificateEntries?.[0];
    if (certificateEntry === undefined) return false;
    if (attribute.type === TSA_SIGNING_CERTIFICATE_OID) {
      const certId = sequenceChildren(certificateEntry);
      const hash = certId === undefined ? undefined : octetStringBytes(certId[0]);
      if (hash === undefined) return false;
      const certificateHash = yield* digest("sha1", certificateDer);
      return bytesEqual(hash, certificateHash);
    }
    const hash = essCertIdV2Hash(certificateEntry);
    if (hash === undefined) return false;
    const certificateHash = yield* digest(hash.algorithm, certificateDer);
    return bytesEqual(hash.hash, certificateHash);
  });

const timestampNonce = (): Effect.Effect<asn1js.Integer, CmsError> =>
  Effect.try({
    try: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[0] = (bytes[0] ?? 0) & 0x7f;
      return new asn1js.Integer({ valueHex: new Uint8Array(bytes).buffer });
    },
    catch: () =>
      new CmsError({
        code: CmsErrorCodeValue.timestampError,
        reason: "Failed to generate the RFC 3161 timestamp nonce.",
        operation: CmsOperationValue.timestamp,
      }),
  });

const RequestTimestampInputSchema = Schema.Struct({
  data: Schema.Uint8Array,
  tsaUrl: Schema.NonEmptyString,
  trustedRoots: Schema.NonEmptyArray(Schema.Uint8Array),
  hashAlgorithm: CmsHashAlgorithmSchema,
  timeoutMillis: Schema.optional(TimeoutMillisSchema),
});
type RequestTimestampInput = (typeof RequestTimestampInputSchema)["Type"];

type TimestampRequestAbort = {
  readonly _tag: "TsaRequestAbort";
  readonly timedOut: boolean;
};

type TimestampDownload =
  | TimestampRequestAbort
  | {
      readonly _tag: "TsaHttpFailure";
      readonly status: number;
    }
  | {
      readonly _tag: "TsaHttpSuccess";
      readonly responseBytes: Uint8Array;
    };

type ParsedTimestampResponse =
  | {
      readonly _tag: "TsaResponseTrailingBytes";
    }
  | {
      readonly _tag: "TsaResponseParsed";
      readonly status: number;
      readonly token: pkijs.ContentInfo | undefined;
      readonly signed: pkijs.SignedData | undefined;
      readonly tstInfo: pkijs.TSTInfo | undefined;
    };

type TimestampAbortHandle = {
  readonly signal: AbortSignal;
  readonly promise: Promise<TimestampRequestAbort>;
  readonly cancel: () => void;
  readonly clear: () => void;
};

const startTimestampAbort = (timeoutMillis: number, signal: AbortSignal): TimestampAbortHandle => {
  const controller = new AbortController();
  const pending = Promise.withResolvers<TimestampRequestAbort>();
  const cancel = (): void => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const abort = (timedOut: boolean): void => {
    cancel();
    pending.resolve({ _tag: "TsaRequestAbort", timedOut });
  };
  const timeoutId = setTimeout(() => abort(true), timeoutMillis);
  const abortFromSignal = (): void => abort(false);
  if (signal.aborted) abortFromSignal();
  else signal.addEventListener("abort", abortFromSignal, { once: true });
  return {
    signal: controller.signal,
    promise: pending.promise,
    cancel,
    clear: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", abortFromSignal);
    },
  };
};

const downloadTimestamp = (
  input: RequestTimestampInput,
  requestDer: Uint8Array,
): Effect.Effect<TimestampDownload, CmsError> =>
  Effect.tryPromise({
    try: (signal): Promise<TimestampDownload> => {
      const abort = startTimestampAbort(input.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS, signal);
      const request = Promise.resolve().then(() =>
        fetch(input.tsaUrl, {
          method: "POST",
          headers: { "content-type": TSA_CONTENT_TYPE },
          body: new Uint8Array(requestDer).buffer,
          signal: abort.signal,
        }).then(async (response): Promise<TimestampDownload> => {
          if (!response.ok) {
            abort.cancel();
            return {
              _tag: "TsaHttpFailure",
              status: response.status,
            };
          }
          return {
            _tag: "TsaHttpSuccess",
            responseBytes: new Uint8Array(await response.arrayBuffer()),
          };
        }),
      );
      return Promise.race([abort.promise, request]).then(
        (result) => {
          abort.clear();
          return result;
        },
        (error) => {
          abort.clear();
          return Promise.reject(error);
        },
      );
    },
    catch: () =>
      new CmsError({
        code: CmsErrorCodeValue.timestampError,
        reason: `TSA request to ${diagnosticTimestampUrl(input.tsaUrl)} failed.`,

        operation: CmsOperationValue.timestamp,
      }),
  });

export const requestTimestamp = (
  input: RequestTimestampInput,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(RequestTimestampInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.timestampError,
            reason: `Invalid RFC 3161 timestamp input: ${String(issue)}`,
            operation: CmsOperationValue.timestamp,
          }),
      ),
    );
    const diagnosticUrl = diagnosticTimestampUrl(valid.tsaUrl);

    const trustedCerts = yield* Effect.try({
      try: () =>
        valid.trustedRoots.map((der) => pkijs.Certificate.fromBER(new Uint8Array(der).buffer)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to parse a TSA trusted root DER.",
          operation: CmsOperationValue.timestamp,
        }),
    });
    const imprint = yield* digest(valid.hashAlgorithm, valid.data);
    const nonce = yield* timestampNonce();

    const requestDer = yield* Effect.try({
      try: () => {
        const request = new pkijs.TimeStampReq({
          version: 1,
          messageImprint: new pkijs.MessageImprint({
            hashAlgorithm: new pkijs.AlgorithmIdentifier({
              algorithmId: hashAlgorithmOid(valid.hashAlgorithm),
            }),
            hashedMessage: new asn1js.OctetString({ valueHex: new Uint8Array(imprint).buffer }),
          }),
          nonce,
          certReq: true,
        });
        return new Uint8Array(request.toSchema().toBER(false));
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to encode the RFC 3161 request.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    const response = yield* downloadTimestamp(valid, requestDer);

    if (response._tag === "TsaRequestAbort") {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: response.timedOut
            ? `TSA request to ${diagnosticUrl} timed out.`
            : `TSA request to ${diagnosticUrl} was aborted.`,

          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (response._tag === "TsaHttpFailure") {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA request to ${diagnosticUrl} failed with HTTP ${response.status}.`,
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const responseBytes = response.responseBytes;

    const parsed = yield* Effect.try({
      try: (): ParsedTimestampResponse => {
        const responseDer = new Uint8Array(responseBytes).buffer;
        const decoded = asn1js.fromBER(responseDer);
        if (decoded.offset !== responseBytes.byteLength) {
          return { _tag: "TsaResponseTrailingBytes" };
        }
        const tsaResponse = pkijs.TimeStampResp.fromBER(responseDer);
        const token = tsaResponse.timeStampToken;
        if (token === undefined) {
          return {
            _tag: "TsaResponseParsed",
            status: tsaResponse.status.status,
            token: undefined,
            signed: undefined,
            tstInfo: undefined,
          };
        }
        const signed = new pkijs.SignedData({ schema: token.content });
        const eContent = signed.encapContentInfo.eContent;
        if (eContent === undefined) {
          return {
            _tag: "TsaResponseParsed",
            status: tsaResponse.status.status,
            token,
            signed,
            tstInfo: undefined,
          };
        }
        const eContentBytes =
          eContent.valueBlock.valueHexView.byteLength === 0
            ? new Uint8Array(eContent.getValue())
            : eContent.valueBlock.valueHexView;
        const tstInfoDer = new Uint8Array(eContentBytes).buffer;
        const tstInfoDecoded = asn1js.fromBER(tstInfoDer);
        if (tstInfoDecoded.offset !== eContentBytes.byteLength) {
          return { _tag: "TsaResponseTrailingBytes" };
        }
        return {
          _tag: "TsaResponseParsed",
          status: tsaResponse.status.status,
          token,
          signed,
          tstInfo: pkijs.TSTInfo.fromBER(tstInfoDer),
        };
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to parse the TSA response.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    if (parsed._tag === "TsaResponseTrailingBytes") {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA response contains trailing bytes.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (
      parsed.status !== pkijs.PKIStatus.granted &&
      parsed.status !== pkijs.PKIStatus.grantedWithMods
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: `TSA did not grant a timestamp token; PKIStatus=${parsed.status}.`,
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const { token, signed, tstInfo } = parsed;
    if (token === undefined || signed === undefined || tstInfo === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA did not return a timestamp token with TSTInfo.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (
      token.contentType !== pkijs.ContentInfo.SIGNED_DATA ||
      signed.encapContentInfo.eContentType !== TSA_TST_INFO_CONTENT_TYPE ||
      signed.signerInfos.length !== 1
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA did not return a valid signed RFC 3161 timestamp token.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const signingCertificateAttribute = timestampSigningCertificateAttribute(signed);
    if (signingCertificateAttribute === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp token is missing required signed attributes.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (!tstInfo.nonce?.isEqual(nonce)) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp nonce does not match the request.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    if (
      tstInfo.messageImprint.hashAlgorithm.algorithmId !== hashAlgorithmOid(valid.hashAlgorithm) ||
      !bytesEqual(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView, imprint)
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp message imprint does not match the request.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const verification = yield* Effect.tryPromise({
      try: () => {
        signed.encapContentInfo.eContentType = pkijs.ContentInfo.DATA;
        return signed.verify({
          signer: 0,
          data: new Uint8Array(valid.data).buffer,
          checkDate: tstInfo.genTime,
          checkChain: true,
          trustedCerts,
          passedWhenNotRevValues: true,
          extendedMode: true,
        });
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp token signature or certificate chain validation failed.",
          operation: CmsOperationValue.timestamp,
        }),
    });

    if (
      verification.signatureVerified !== true ||
      verification.signerCertificateVerified !== true
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA timestamp token signature or certificate chain is invalid.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const signerCertificate = verification.signerCertificate;
    if (
      signerCertificate === null ||
      signerCertificate === undefined ||
      !isTimestampAuthorityCertificate(signerCertificate)
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA signer certificate is not a critical timestamping-only certificate.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    const signerCertificateDer = yield* Effect.try({
      try: () => new Uint8Array(signerCertificate.toSchema(true).toBER(false)),
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "Failed to encode the TSA signer certificate.",
          operation: CmsOperationValue.timestamp,
        }),
    });
    const signingCertificateBound = yield* signingCertificateMatches(
      signingCertificateAttribute,
      signerCertificateDer,
    );
    if (!signingCertificateBound) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.timestampError,
          reason: "TSA signing-certificate attribute does not bind the signer certificate.",
          operation: CmsOperationValue.timestamp,
        }),
      );
    }

    return new Uint8Array(token.toSchema().toBER(false));
  });
