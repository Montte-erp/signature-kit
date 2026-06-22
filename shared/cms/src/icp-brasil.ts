import { type Asn1Error, bytesOf, childrenOf, decode, oidString } from "@signature-kit/asn1";
import { Duration, Effect } from "effect";
import {
  type CmsHashAlgorithm,
  type IcpBrasilPolicy,
  CmsError,
  CmsErrorCodeValue,
  CmsOperationValue,
  safeCauseMetadata,
} from "./config";

export const IcpBrasilPadesPolicy = {
  adRbV11: {
    policyOid: "2.16.76.1.7.1.11.1.1",
    policyUri: "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der",
  },
} as const;

const DEFAULT_POLICY_TIMEOUT_MILLIS = 10000;
let cachedAdRbV11: IcpBrasilPolicy | null = null;

const asn1ToCms = (error: Asn1Error): CmsError =>
  new CmsError({
    code: CmsErrorCodeValue.policyError,
    reason: error.message,
    operation: CmsOperationValue.policy,
    upstreamTag: error._tag,
    upstreamCode: error.code,
  });

const cmsHashAlgorithmFromOid = (oid: string): Effect.Effect<CmsHashAlgorithm, CmsError> => {
  switch (oid) {
    case "1.3.14.3.2.26":
      return Effect.succeed("sha1");
    case "2.16.840.1.101.3.4.2.1":
      return Effect.succeed("sha256");
    case "2.16.840.1.101.3.4.2.2":
      return Effect.succeed("sha384");
    case "2.16.840.1.101.3.4.2.3":
      return Effect.succeed("sha512");
    default:
      return Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: `Unsupported ICP-Brasil policy hash algorithm OID: ${oid}.`,
          operation: CmsOperationValue.policy,
        }),
      );
  }
};

export const clearIcpBrasilPolicyCache = (): void => {
  cachedAdRbV11 = null;
};

export const parseIcpBrasilPadesPolicy = (
  policyDer: Uint8Array,
): Effect.Effect<IcpBrasilPolicy, CmsError> =>
  Effect.gen(function* () {
    const root = yield* decode(policyDer).pipe(Effect.mapError(asn1ToCms));
    const policyFields = yield* childrenOf(root).pipe(Effect.mapError(asn1ToCms));
    const algorithmIdentifier = policyFields[0];
    const policyHashNode = policyFields[2];
    if (algorithmIdentifier === undefined || policyHashNode === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER does not contain algorithm and hash fields.",
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const algorithmFields = yield* childrenOf(algorithmIdentifier).pipe(Effect.mapError(asn1ToCms));
    const algorithmOidNode = algorithmFields[0];
    if (algorithmOidNode === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER does not contain a hash algorithm OID.",
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const algorithmOid = yield* oidString(algorithmOidNode).pipe(Effect.mapError(asn1ToCms));
    const policyHashAlgorithm = yield* cmsHashAlgorithmFromOid(algorithmOid);
    const policyHash = yield* bytesOf(policyHashNode).pipe(Effect.mapError(asn1ToCms));

    return {
      policyOid: IcpBrasilPadesPolicy.adRbV11.policyOid,
      policyHash,
      policyHashAlgorithm,
      policyUri: IcpBrasilPadesPolicy.adRbV11.policyUri,
    };
  });

export const fetchIcpBrasilPadesPolicy = (options?: {
  readonly timeoutMillis?: number | undefined;
}): Effect.Effect<IcpBrasilPolicy, CmsError> => {
  if (cachedAdRbV11 !== null) return Effect.succeed(cachedAdRbV11);

  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(IcpBrasilPadesPolicy.adRbV11.policyUri, { signal }),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "Failed to download the ICP-Brasil PAdES AD-RB policy.",
          operation: CmsOperationValue.policy,
          ...safeCauseMetadata(cause),
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options?.timeoutMillis ?? DEFAULT_POLICY_TIMEOUT_MILLIS),
        orElse: () =>
          Effect.fail(
            new CmsError({
              code: CmsErrorCodeValue.policyError,
              reason: "Timed out downloading the ICP-Brasil PAdES AD-RB policy.",
              operation: CmsOperationValue.policy,
            }),
          ),
      }),
    );

    if (!response.ok) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: `ICP-Brasil PAdES policy download failed with HTTP ${response.status}.`,
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const policyDer = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (cause) =>
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "Failed to read the ICP-Brasil PAdES AD-RB policy response.",
          operation: CmsOperationValue.policy,
          ...safeCauseMetadata(cause),
        }),
    });

    const policy = yield* parseIcpBrasilPadesPolicy(new Uint8Array(policyDer));
    cachedAdRbV11 = policy;
    return policy;
  });
};
