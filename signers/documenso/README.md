# @signature-kit/documenso

Alchemy v2 remote-signature provider for Documenso envelope creation, lookup, listing, cancellation, deletion, and completed-document download.

## Install

```sh
bun add @signature-kit/documenso @signature-kit/http effect alchemy
```

`effect` and `alchemy` are direct runtime dependencies. Provide `signatureHttpClientLive` at the stack boundary; `providers(options)` supplies only Documenso credentials and resource providers.

## Public surface

- `@signature-kit/documenso` — Documenso envelope/document/recipient schemas, `DocumensoSignatureRequest`, `DocumensoProviders`, `providers`, `getDocumensoSignatureRequest`, `listDocumensoSignatureRequests`, `cancelDocumensoSignatureRequest`, `deleteDocumensoSignatureRequest`, and `downloadDocumensoSignedDocument`.

Capability matrix:

| Capability                       | Supported                                                                 |
| -------------------------------- | ------------------------------------------------------------------------- |
| Create retained Alchemy envelope | Yes                                                                       |
| Get envelope                     | Yes                                                                       |
| List envelopes                   | Yes                                                                       |
| Cancel envelope                  | Yes                                                                       |
| Delete envelope                  | Yes                                                                       |
| Download signed document         | Yes, after the envelope is completed and an envelope item id is available |

Retained-resource semantics: Alchemy `reconcile` creates once and returns cached output on subsequent plans; provider `list` returns `[]`; `nuke` is skipped. Multi-step create rollback deletes remote state only after unambiguous pre-effect 4xx failures, excluding 408, 409, 429, 5xx, timeouts, and response-shape failures.

## Example

```ts
import * as Alchemy from "alchemy";
import {
  DocumensoSignatureRequest,
  downloadDocumensoSignedDocument,
  providers as documensoProviders,
  type DocumensoProviderOptions,
} from "@signature-kit/documenso";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Layer, Redacted } from "effect";

declare const pdfBase64: string;
declare const apiKey: string;

const options: DocumensoProviderOptions = {
  apiKey: Redacted.make(apiKey),
};

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: documensoProviders(options).pipe(
      Layer.provide(signatureHttpClientLive),
      Layer.orDie,
    ),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* DocumensoSignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [
        { fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 },
      ],
      recipients: [{ name: "Ada Lovelace", email: "ada@example.com", role: "signer" }],
      send: true,
    });
  }),
) {}

export const downloadSigned = (envelopeId: string) =>
  downloadDocumensoSignedDocument(options, envelopeId).pipe(
    Effect.provide(signatureHttpClientLive),
  );
```

## Errors and i18n

Invalid inputs, remote HTTP failures, unsupported operations, and invalid response shapes fail as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `errorMessage` from `@signature-kit/i18n` with the `signatureKitErrorMessages` catalog from `@signature-kit/signatures`.

Docs: <https://signaturekit.dev/en-US/docs/providers/documenso>.

## License

MIT. See `LICENSE`.
