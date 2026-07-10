# @signature-kit/xml

XML-DSig document signing and verification through an explicit `XmlRuntime` service for DOM parsing, serializer capabilities, `SignedXml` construction, and cached verification-key import.

## Install

```sh
bun add @signature-kit/xml @signature-kit/signatures effect
```

Add a signer backend at the application boundary, for example:

```sh
bun add @signature-kit/a1
```

`effect` is a direct runtime dependency. DOM/XML runtime state is provided through `xmlRuntimeLayer`.

## Public surface

- `@signature-kit/xml/config` — XML signing/verification schemas, algorithm/canonicalization contracts, error catalog, and message catalog.
- `@signature-kit/xml/runtime` — `XmlRuntime`, `XmlRuntimeService`, and `xmlRuntimeLayer`.
- `@signature-kit/xml/sign` — `signXml`.
- `@signature-kit/xml/verify` — `verifyXml`.

Verification requires exactly one explicit key source: `publicKeyDer` or `trustedCertificateDer`, never both. Self-signed embedded certificates are not accepted as valid signers by default. Verification rejects duplicate or hidden target references; `requiredReference` additionally binds a signed URI to a unique namespace-aware direct-child path from the document element to the target.

To bound verification work, documents with more than 4 `<Signature>` elements, more than 4 direct `SignedInfo` `<Reference>` elements in one signature, more than 8 such references in total, more than 3 direct `<Transform>` elements in one reference, more than 8 transforms in total, or a repeated canonicalization transform in a reference return `valid: false` before cryptographic verification.

Only XML 1.0 is accepted. Parser guardrails reject input above 10 MiB, 16,384 nodes, 2,048 attributes, 64 namespace declarations, or depth 1,024. `InclusiveNamespaces` `PrefixList` values are capped at 4,096 characters and 64 tokens.

Documents must contain exactly one root element. Other than the optional leading XML declaration and XML whitespace, prolog and epilog content is rejected.

`signXml` revalidates its serialized result with these guards and fails with `xml.SIGN_FAILED` rather than returning XML that `verifyXml` would reject.

## Example

```ts
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signXml } from "@signature-kit/xml/sign";
import { verifyXml } from "@signature-kit/xml/verify";
import { xmlRuntimeLayer } from "@signature-kit/xml/runtime";
import { Effect, Redacted } from "effect";

declare const xml: string;
declare const pfx: Uint8Array;
declare const trustedCertificateDer: Uint8Array;

const program = Effect.gen(function* () {
  const signedXml = yield* signXml({
    xml,
    referenceId: "invoice-1",
    algorithm: "rsa-sha256",
  });

  const verification = yield* verifyXml({
    xml: signedXml,
    trustedCertificateDer,
    requiredReference: {
      uri: "#invoice-1",
      path: [{ localName: "invoice", namespaceUri: null }],
    },
  });

  return { signedXml, verification };
}).pipe(
  Effect.provide(xmlRuntimeLayer),
  Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("secret") })),
);
```

## Errors and i18n

XML failures use the `XmlError` code catalog and `xmlErrorMessages`; signer failures can also surface from signing. Applications can render localized copy through `@signature-kit/i18n` with the catalogs for every package they call.

Docs: <https://signaturekit.dev/en-US/docs/signing/xml>.

## License

MIT. See `LICENSE`.
