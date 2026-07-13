import { bytesOf, childrenOf, decode, oidString } from "@signature-kit/asn1";
import { Effect, Schema } from "effect";
import { CmsError, CmsErrorCodeValue, CmsOperationValue, TimeoutMillisSchema } from "./config.js";
import type { CmsHashAlgorithm, IcpBrasilPolicy } from "./config.js";

const FetchIcpBrasilPadesPolicyOptionsSchema = Schema.Struct({
  timeoutMillis: Schema.optional(TimeoutMillisSchema),
});
type FetchIcpBrasilPadesPolicyOptions = (typeof FetchIcpBrasilPadesPolicyOptionsSchema)["Type"];

const ICP_BRASIL_AD_RB_V11_POLICY_HASH = Uint8Array.of(
  0x44,
  0xfc,
  0x58,
  0x16,
  0xeb,
  0x2d,
  0x70,
  0x5d,
  0x8c,
  0x8f,
  0x02,
  0x2a,
  0x7f,
  0x93,
  0xb3,
  0xfb,
  0x49,
  0xed,
  0xfa,
  0xe1,
  0xa7,
  0xb9,
  0x14,
  0x9e,
  0xf6,
  0xfa,
  0xb8,
  0x33,
  0xe9,
  0xbb,
  0x63,
  0xf8,
);

const ICP_BRASIL_AD_RB_V11_POLICY_OID = "2.16.76.1.7.1.11.1.1";
const ICP_BRASIL_AD_RB_V11_POLICY_HASH_ALGORITHM: CmsHashAlgorithm = "sha256";
const ICP_BRASIL_AD_RB_V11_POLICY_URI = "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der";

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

export const IcpBrasilPadesPolicy: { readonly adRbV11: IcpBrasilPolicy } = {
  adRbV11: {
    policyOid: ICP_BRASIL_AD_RB_V11_POLICY_OID,
    policyHash: Uint8Array.from(ICP_BRASIL_AD_RB_V11_POLICY_HASH),
    policyHashAlgorithm: ICP_BRASIL_AD_RB_V11_POLICY_HASH_ALGORITHM,
    policyUri: ICP_BRASIL_AD_RB_V11_POLICY_URI,
  },
};

const DEFAULT_POLICY_TIMEOUT_MILLIS = 10000;

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

export const parseIcpBrasilPadesPolicy = (
  policyDer: Uint8Array,
): Effect.Effect<IcpBrasilPolicy, CmsError> =>
  Effect.gen(function* () {
    const root = yield* decode(policyDer);
    if (root.kind !== "constructed" || root.class !== "universal" || root.tag !== 0x10) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER root is not a universal SEQUENCE.",
          operation: CmsOperationValue.policy,
        }),
      );
    }
    const policyFields = yield* childrenOf(root);
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
    if (
      algorithmIdentifier.kind !== "constructed" ||
      algorithmIdentifier.class !== "universal" ||
      algorithmIdentifier.tag !== 0x10
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER algorithm identifier is not a universal SEQUENCE.",
          operation: CmsOperationValue.policy,
        }),
      );
    }
    if (
      policyHashNode.kind !== "primitive" ||
      policyHashNode.class !== "universal" ||
      policyHashNode.tag !== 0x04
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER hash is not a universal OCTET STRING.",
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const algorithmFields = yield* childrenOf(algorithmIdentifier);
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
    if (
      algorithmOidNode.kind !== "primitive" ||
      algorithmOidNode.class !== "universal" ||
      algorithmOidNode.tag !== 0x06
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "ICP-Brasil policy DER hash algorithm is not a universal OID.",
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const algorithmOid = yield* oidString(algorithmOidNode);
    const policyHashAlgorithm = yield* cmsHashAlgorithmFromOid(algorithmOid);
    const policyHash = yield* bytesOf(policyHashNode);

    return {
      policyOid: ICP_BRASIL_AD_RB_V11_POLICY_OID,
      policyHash,
      policyHashAlgorithm,
      policyUri: ICP_BRASIL_AD_RB_V11_POLICY_URI,
    };
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "Asn1Error"
        ? new CmsError({
            code: CmsErrorCodeValue.policyError,
            reason: error.reason ?? error.message,
            operation: CmsOperationValue.policy,
          })
        : error,
    ),
  );

type PolicyRequestAbort = {
  readonly _tag: "PolicyRequestAbort";
  readonly timedOut: boolean;
};

type PolicyDownload =
  | PolicyRequestAbort
  | {
      readonly _tag: "PolicyHttpFailure";
      readonly status: number;
    }
  | {
      readonly _tag: "PolicyHttpSuccess";
      readonly policyDer: Uint8Array;
    };

type PolicyAbortHandle = {
  readonly signal: AbortSignal;
  readonly promise: Promise<PolicyRequestAbort>;
  readonly cancel: () => void;
  readonly clear: () => void;
};

const startPolicyAbort = (timeoutMillis: number, signal: AbortSignal): PolicyAbortHandle => {
  const controller = new AbortController();
  const pending = Promise.withResolvers<PolicyRequestAbort>();
  const cancel = (): void => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const abort = (timedOut: boolean): void => {
    cancel();
    pending.resolve({ _tag: "PolicyRequestAbort", timedOut });
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

const downloadIcpBrasilPadesPolicy = (
  timeoutMillis: number | undefined,
): Effect.Effect<PolicyDownload, CmsError> =>
  Effect.tryPromise({
    try: (signal): Promise<PolicyDownload> => {
      const abort = startPolicyAbort(timeoutMillis ?? DEFAULT_POLICY_TIMEOUT_MILLIS, signal);
      const request = Promise.resolve().then(() =>
        fetch(ICP_BRASIL_AD_RB_V11_POLICY_URI, { signal: abort.signal }).then(
          async (response): Promise<PolicyDownload> => {
            if (!response.ok) {
              abort.cancel();
              return {
                _tag: "PolicyHttpFailure",
                status: response.status,
              };
            }
            return {
              _tag: "PolicyHttpSuccess",
              policyDer: new Uint8Array(await response.arrayBuffer()),
            };
          },
        ),
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
        code: CmsErrorCodeValue.policyError,
        reason: "Failed to download the ICP-Brasil PAdES AD-RB policy.",
        operation: CmsOperationValue.policy,
      }),
  });

export const fetchIcpBrasilPadesPolicy = (
  options?: FetchIcpBrasilPadesPolicyOptions,
): Effect.Effect<IcpBrasilPolicy, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(FetchIcpBrasilPadesPolicyOptionsSchema)(
      options ?? {},
    ).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.policyError,
            reason: `Invalid ICP-Brasil PAdES policy fetch options: ${String(issue)}`,
            operation: CmsOperationValue.policy,
          }),
      ),
    );
    const response = yield* downloadIcpBrasilPadesPolicy(valid.timeoutMillis);
    if (response._tag === "PolicyRequestAbort") {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: response.timedOut
            ? "Timed out downloading the ICP-Brasil PAdES AD-RB policy."
            : "ICP-Brasil PAdES AD-RB policy download was aborted.",
          operation: CmsOperationValue.policy,
        }),
      );
    }

    if (response._tag === "PolicyHttpFailure") {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: `ICP-Brasil PAdES policy download failed with HTTP ${response.status}.`,
          operation: CmsOperationValue.policy,
        }),
      );
    }

    const policy = yield* parseIcpBrasilPadesPolicy(response.policyDer);
    if (
      policy.policyHashAlgorithm !== ICP_BRASIL_AD_RB_V11_POLICY_HASH_ALGORITHM ||
      !bytesEqual(policy.policyHash, ICP_BRASIL_AD_RB_V11_POLICY_HASH)
    ) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.policyError,
          reason: "Downloaded ICP-Brasil PAdES AD-RB policy does not match the pinned policy hash.",
          operation: CmsOperationValue.policy,
        }),
      );
    }
    return policy;
  });
