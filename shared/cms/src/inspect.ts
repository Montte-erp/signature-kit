import * as asn1js from "asn1js";
import { decode, oidString } from "@signature-kit/asn1";
import type { Asn1Error, Asn1Node } from "@signature-kit/asn1";
import { Effect, Option, Schema } from "effect";
import * as pkijs from "pkijs";
import { CmsError, CmsErrorCodeValue, CmsOid, CmsOperationValue } from "./config";
import { digest, toArrayBuffer } from "./engine";

export const CmsSignedAttributeSchema = Schema.Struct({
  type: Schema.NonEmptyString,
  valueOids: Schema.Array(Schema.String),
  signaturePolicyId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});
export type CmsSignedAttribute = (typeof CmsSignedAttributeSchema)["Type"];

export const CmsSignedDataInspectionSchema = Schema.Struct({
  signerCommonName: Schema.NullOr(Schema.String),
  signerCertificateDer: Schema.NullOr(Schema.Uint8Array),
  signedAttributes: Schema.Array(CmsSignedAttributeSchema),
});
export type CmsSignedDataInspection = (typeof CmsSignedDataInspectionSchema)["Type"];

export const InspectDetachedSignedDataInputSchema = Schema.Struct({
  cms: Schema.Uint8Array,
});
export type InspectDetachedSignedDataInput = (typeof InspectDetachedSignedDataInputSchema)["Type"];

type BerSerializable = {
  readonly toBER: (sizeOnly?: boolean) => ArrayBuffer;
};

type BerSchemaSerializable = {
  readonly toSchema: (encodeFlag?: boolean) => BerSerializable;
};

type StringValue = {
  readonly valueBlock: {
    readonly value: string;
  };
};

type X509NameEntry = {
  readonly type: string;
  readonly value: StringValue;
};

type SubjectPublicKey = {
  readonly valueBlock: {
    readonly valueHexView: Uint8Array;
  };
};

type SubjectPublicKeyInfo = {
  readonly subjectPublicKey: SubjectPublicKey;
};

type Asn1OctetString = {
  readonly idBlock: {
    readonly tagClass: number;
    readonly tagNumber: number;
    readonly isConstructed: boolean;
  };
  readonly valueBlock: {
    readonly valueHexView: Uint8Array;
  };
};

type PkiJsExtension = {
  readonly extnID: string;
  readonly extnValue: Asn1OctetString;
};

type InspectableCertificate = BerSchemaSerializable & {
  readonly subject: {
    readonly typesAndValues: readonly X509NameEntry[];
  };
  readonly issuer: BerSchemaSerializable;
  readonly serialNumber: BerSerializable;
  readonly subjectPublicKeyInfo: SubjectPublicKeyInfo;
  readonly extensions?: readonly PkiJsExtension[];
};

type SignerIssuerAndSerial = {
  readonly issuer: BerSchemaSerializable;
  readonly serialNumber: BerSerializable;
};

type SignerIdentifier =
  | {
      readonly type: "issuerAndSerial";
      readonly issuerAndSerial: SignerIssuerAndSerial;
    }
  | {
      readonly type: "subjectKeyIdentifier";
      readonly subjectKeyIdentifier: Uint8Array;
    };

const COMMON_NAME_OID = "2.5.4.3";
const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
const isObject = (value: unknown): value is object => value !== null && typeof value === "object";

const isUint8Array = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === "[object Uint8Array]";

const BerSerializableSchema = Schema.declare<BerSerializable>((value): value is BerSerializable => {
  if (!isObject(value)) return false;
  return typeof Reflect.get(value, "toBER") === "function";
});

const BerSchemaSerializableSchema = Schema.declare<BerSchemaSerializable>(
  (value): value is BerSchemaSerializable => {
    if (!isObject(value)) return false;
    return typeof Reflect.get(value, "toSchema") === "function";
  },
);

const SubjectPublicKeySchema = Schema.declare<SubjectPublicKey>(
  (value): value is SubjectPublicKey => {
    if (!isObject(value)) return false;
    const valueBlock = Reflect.get(value, "valueBlock");
    return isObject(valueBlock) && isUint8Array(Reflect.get(valueBlock, "valueHexView"));
  },
);

const Asn1OctetStringSchema = Schema.declare<Asn1OctetString>((value): value is Asn1OctetString => {
  if (!isObject(value)) return false;
  const idBlock = Reflect.get(value, "idBlock");
  const valueBlock = Reflect.get(value, "valueBlock");
  return (
    isObject(idBlock) &&
    Reflect.get(idBlock, "tagClass") === 1 &&
    Reflect.get(idBlock, "tagNumber") === 4 &&
    Reflect.get(idBlock, "isConstructed") === false &&
    isObject(valueBlock) &&
    isUint8Array(Reflect.get(valueBlock, "valueHexView"))
  );
});

const PkiJsExtensionSchema = Schema.declare<PkiJsExtension>((value): value is PkiJsExtension => {
  if (!isObject(value)) return false;
  return (
    typeof Reflect.get(value, "extnID") === "string" &&
    Schema.is(Asn1OctetStringSchema)(Reflect.get(value, "extnValue"))
  );
});

const SubjectPublicKeyInfoSchema = Schema.declare<SubjectPublicKeyInfo>(
  (value): value is SubjectPublicKeyInfo => {
    if (!isObject(value)) return false;
    return Schema.is(SubjectPublicKeySchema)(Reflect.get(value, "subjectPublicKey"));
  },
);
const SignerIssuerAndSerialSchema = Schema.declare<SignerIssuerAndSerial>(
  (value): value is SignerIssuerAndSerial => {
    if (!isObject(value)) return false;
    return (
      Schema.is(BerSchemaSerializableSchema)(Reflect.get(value, "issuer")) &&
      Schema.is(BerSerializableSchema)(Reflect.get(value, "serialNumber"))
    );
  },
);

const subjectKeyIdentifierFromSid = (sid: unknown): Uint8Array | undefined => {
  if (!isObject(sid)) return undefined;
  const idBlock = Reflect.get(sid, "idBlock");
  const valueBlock = Reflect.get(sid, "valueBlock");
  if (!isObject(idBlock) || !isObject(valueBlock)) return undefined;
  if (Reflect.get(idBlock, "tagClass") !== 3 || Reflect.get(idBlock, "tagNumber") !== 0) {
    return undefined;
  }
  if (Reflect.get(idBlock, "isConstructed") === true) {
    const values = Reflect.get(valueBlock, "value");
    if (!Array.isArray(values)) return undefined;
    const first = values[0];
    if (!isObject(first)) return undefined;
    const firstValueBlock = Reflect.get(first, "valueBlock");
    const firstValueHexView = isObject(firstValueBlock)
      ? Reflect.get(firstValueBlock, "valueHexView")
      : undefined;
    return isUint8Array(firstValueHexView) ? firstValueHexView : undefined;
  }
  const valueHexView = Reflect.get(valueBlock, "valueHexView");
  return isUint8Array(valueHexView) ? valueHexView : undefined;
};

const signerIdentifierFromSid = (sid: unknown): SignerIdentifier | undefined => {
  const issuerAndSerial = Option.getOrUndefined(
    Schema.decodeUnknownOption(SignerIssuerAndSerialSchema)(sid),
  );
  if (issuerAndSerial !== undefined) {
    return { type: "issuerAndSerial", issuerAndSerial };
  }
  const subjectKeyIdentifier = subjectKeyIdentifierFromSid(sid);
  return subjectKeyIdentifier === undefined
    ? undefined
    : { type: "subjectKeyIdentifier", subjectKeyIdentifier };
};

const derBytes = (value: BerSerializable | BerSchemaSerializable): Uint8Array =>
  "toBER" in value
    ? new Uint8Array(value.toBER(false))
    : new Uint8Array(value.toSchema(true).toBER(false));

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const matchesSignerSid = (
  certificate: InspectableCertificate,
  sid: SignerIssuerAndSerial,
): boolean =>
  bytesEqual(derBytes(certificate.issuer), derBytes(sid.issuer)) &&
  bytesEqual(derBytes(certificate.serialNumber), derBytes(sid.serialNumber));

const subjectKeyIdentifierFromCertificate = (
  certificate: InspectableCertificate,
): Uint8Array | null | undefined => {
  const subjectKeyIdentifierExtensions = certificate.extensions?.filter(
    (extension) => extension.extnID === SUBJECT_KEY_IDENTIFIER_OID,
  );
  if (subjectKeyIdentifierExtensions === undefined || subjectKeyIdentifierExtensions.length === 0) {
    return undefined;
  }
  if (subjectKeyIdentifierExtensions.length !== 1) return null;
  const subjectKeyIdentifierExtension = subjectKeyIdentifierExtensions[0];
  if (subjectKeyIdentifierExtension === undefined) return null;

  const encodedSubjectKeyIdentifier =
    subjectKeyIdentifierExtension.extnValue.valueBlock.valueHexView;
  const decodedSubjectKeyIdentifier = asn1js.fromBER(toArrayBuffer(encodedSubjectKeyIdentifier));
  if (
    decodedSubjectKeyIdentifier.offset !== encodedSubjectKeyIdentifier.byteLength ||
    !Schema.is(Asn1OctetStringSchema)(decodedSubjectKeyIdentifier.result)
  ) {
    return null;
  }
  return decodedSubjectKeyIdentifier.result.valueBlock.valueHexView;
};

const findSignerCertificate = (
  certificates: readonly unknown[] | undefined,
  sid: SignerIdentifier | undefined,
): Effect.Effect<InspectableCertificate | undefined, CmsError> =>
  Effect.gen(function* () {
    if (sid === undefined) return undefined;
    for (const certificate of certificates ?? []) {
      const inspectable = Option.getOrUndefined(
        Schema.decodeUnknownOption(InspectableCertificateSchema)(certificate),
      );
      if (inspectable === undefined) continue;
      if (sid.type === "issuerAndSerial") {
        if (matchesSignerSid(inspectable, sid.issuerAndSerial)) return inspectable;
        continue;
      }
      const certificateSubjectKeyIdentifier = subjectKeyIdentifierFromCertificate(inspectable);
      if (certificateSubjectKeyIdentifier === null) continue;
      if (certificateSubjectKeyIdentifier !== undefined) {
        if (bytesEqual(certificateSubjectKeyIdentifier, sid.subjectKeyIdentifier)) {
          return inspectable;
        }
        continue;
      }
      const keyIdentifier = yield* digest(
        "sha1",
        inspectable.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView,
      );
      if (bytesEqual(keyIdentifier, sid.subjectKeyIdentifier)) return inspectable;
    }
    return undefined;
  });

const hasStringValue = (value: unknown): value is StringValue => {
  if (!isObject(value)) return false;
  const valueBlock = Reflect.get(value, "valueBlock");
  if (!isObject(valueBlock)) return false;
  return typeof Reflect.get(valueBlock, "value") === "string";
};

const hasNameEntry = (value: unknown): value is X509NameEntry => {
  if (!isObject(value)) return false;
  return (
    typeof Reflect.get(value, "type") === "string" && hasStringValue(Reflect.get(value, "value"))
  );
};

const InspectableCertificateSchema = Schema.declare<InspectableCertificate>(
  (value): value is InspectableCertificate => {
    if (!isObject(value)) return false;
    const subject = Reflect.get(value, "subject");
    const typesAndValues = isObject(subject) ? Reflect.get(subject, "typesAndValues") : undefined;
    const extensions = Reflect.get(value, "extensions");
    return (
      Schema.is(BerSchemaSerializableSchema)(value) &&
      Schema.is(BerSchemaSerializableSchema)(Reflect.get(value, "issuer")) &&
      Schema.is(BerSerializableSchema)(Reflect.get(value, "serialNumber")) &&
      Schema.is(SubjectPublicKeyInfoSchema)(Reflect.get(value, "subjectPublicKeyInfo")) &&
      Array.isArray(typesAndValues) &&
      typesAndValues.every(hasNameEntry) &&
      (extensions === undefined ||
        (Array.isArray(extensions) && extensions.every(Schema.is(PkiJsExtensionSchema))))
    );
  },
);

const collectOidStrings = (node: Asn1Node): Effect.Effect<readonly string[], Asn1Error> =>
  Effect.gen(function* () {
    if (node.kind === "primitive") {
      return node.class === "universal" && node.tag === 0x06 ? [yield* oidString(node)] : [];
    }
    const nested = yield* Effect.forEach(node.children, collectOidStrings);
    return nested.flat();
  });

const berValueToDer = (value: unknown): Effect.Effect<Uint8Array, CmsError> =>
  Schema.decodeUnknownEffect(BerSerializableSchema)(value).pipe(
    Effect.mapError(
      (issue) =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: `Invalid CMS signed attribute value: ${String(issue)}`,
          operation: CmsOperationValue.attributes,
        }),
    ),
    Effect.flatMap((berValue) =>
      Effect.try({
        try: () => new Uint8Array(berValue.toBER(false)),
        catch: () =>
          new CmsError({
            code: CmsErrorCodeValue.decodeError,
            reason: "Failed to serialize a CMS signed attribute value.",
            operation: CmsOperationValue.attributes,
          }),
      }),
    ),
  );

const valueOids = (value: unknown): Effect.Effect<readonly string[], CmsError> =>
  Effect.gen(function* () {
    const der = yield* berValueToDer(value);
    const node = yield* decode(der).pipe(
      Effect.mapError(
        (error) =>
          new CmsError({
            code: CmsErrorCodeValue.decodeError,
            reason: error.reason ?? error.message,
            operation: CmsOperationValue.attributes,
          }),
      ),
    );
    return yield* collectOidStrings(node).pipe(
      Effect.mapError(
        (error) =>
          new CmsError({
            code: CmsErrorCodeValue.decodeError,
            reason: error.reason ?? error.message,
            operation: CmsOperationValue.attributes,
          }),
      ),
    );
  });

const signaturePolicyIdFromNode = (node: Asn1Node): Effect.Effect<string | null, CmsError> =>
  Effect.gen(function* () {
    if (node.kind === "primitive") {
      if (node.class === "universal" && node.tag === 0x06) {
        return yield* oidString(node).pipe(
          Effect.mapError(
            (error) =>
              new CmsError({
                code: CmsErrorCodeValue.decodeError,
                reason: error.reason ?? error.message,
                operation: CmsOperationValue.attributes,
              }),
          ),
        );
      }
      return null;
    }
    if (node.children.length === 0) return null;
    const firstChild = node.children[0];
    if (firstChild === undefined) return null;
    return yield* signaturePolicyIdFromNode(firstChild);
  });

const signaturePolicyIdFromValue = (value: unknown): Effect.Effect<string | null, CmsError> =>
  Effect.gen(function* () {
    const der = yield* berValueToDer(value);
    const node = yield* decode(der).pipe(
      Effect.mapError(
        (error) =>
          new CmsError({
            code: CmsErrorCodeValue.decodeError,
            reason: error.reason ?? error.message,
            operation: CmsOperationValue.attributes,
          }),
      ),
    );
    return yield* signaturePolicyIdFromNode(node);
  });

const inspectAttribute = (
  attribute: pkijs.Attribute,
): Effect.Effect<CmsSignedAttribute, CmsError> =>
  Effect.gen(function* () {
    const nested = yield* Effect.forEach(attribute.values, valueOids);
    const signaturePolicyId =
      attribute.type === CmsOid.signaturePolicy
        ? yield* Effect.gen(function* () {
            for (const value of attribute.values) {
              const valuePolicyId = yield* signaturePolicyIdFromValue(value);
              if (valuePolicyId !== null) return valuePolicyId;
            }
            return null;
          })
        : undefined;

    return {
      type: attribute.type,
      valueOids: nested.flat(),
      signaturePolicyId,
    };
  });

export const inspectDetachedSignedData = (
  input: InspectDetachedSignedDataInput,
): Effect.Effect<CmsSignedDataInspection, CmsError> =>
  Effect.gen(function* () {
    const valid = yield* Schema.decodeUnknownEffect(InspectDetachedSignedDataInputSchema)(
      input,
    ).pipe(
      Effect.mapError(
        (issue) =>
          new CmsError({
            code: CmsErrorCodeValue.decodeError,
            reason: `Invalid CMS inspection input: ${String(issue)}`,
            operation: CmsOperationValue.attributes,
          }),
      ),
    );

    const signed = yield* Effect.try({
      try: () => {
        const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(valid.cms));
        return new pkijs.SignedData({ schema: contentInfo.content });
      },
      catch: () =>
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "Failed to parse the CMS ContentInfo.",
          operation: CmsOperationValue.parse,
        }),
    });

    const signerInfo = signed.signerInfos[0];
    if (signerInfo === undefined) {
      return yield* Effect.fail(
        new CmsError({
          code: CmsErrorCodeValue.decodeError,
          reason: "CMS SignedData does not contain a signer info.",
          operation: CmsOperationValue.parse,
        }),
      );
    }

    const attributes = yield* Effect.forEach(
      signerInfo.signedAttrs?.attributes ?? [],
      inspectAttribute,
    );
    const signerSid = signerIdentifierFromSid(signerInfo.sid);
    const inspectableCertificate = yield* findSignerCertificate(signed.certificates, signerSid);

    return {
      signerCommonName:
        inspectableCertificate === undefined
          ? null
          : (inspectableCertificate.subject.typesAndValues.find(
              (entry) => entry.type === COMMON_NAME_OID,
            )?.value.valueBlock.value ?? null),
      signerCertificateDer:
        inspectableCertificate === undefined
          ? null
          : yield* Effect.try({
              try: () => new Uint8Array(inspectableCertificate.toSchema(true).toBER(false)),
              catch: () =>
                new CmsError({
                  code: CmsErrorCodeValue.decodeError,
                  reason: "Failed to serialize the CMS signer certificate.",
                  operation: CmsOperationValue.parse,
                }),
            }),
      signedAttributes: attributes,
    };
  });
