# @signature-kit/docuseal

Alchemy v2 remote-signature provider for DocuSeal submission creation, lookup, listing, deletion, and completed-document download.

## Install

```sh
bun add @signature-kit/docuseal @signature-kit/http effect alchemy
```

`effect` and `alchemy` are direct runtime dependencies. Provide
`signatureHttpClientLive` at the stack boundary; `providers(options)` supplies
only DocuSeal credentials and resource providers. Provider options are stored as
a cached credential Effect, so retained `list` hooks and `read` calls without
cached output do not decode credentials.

## Public surface

- `@signature-kit/docuseal` — DocuSeal submission/document/submitter schemas, `DocuSealSignatureRequest`, `DocuSealProviders`, `providers`, `getDocuSealSignatureRequest`, `listDocuSealSignatureRequests`, `deleteDocuSealSignatureRequest`, and `downloadDocuSealSignedDocument`.

Capability matrix:

| Capability                         | Supported                                                       |
| ---------------------------------- | --------------------------------------------------------------- |
| Create retained Alchemy submission | Yes                                                             |
| Get submission                     | Yes                                                             |
| List submissions                   | Yes                                                             |
| Cancel submission                  | No public cancel helper is exposed                              |
| Delete submission                  | Yes                                                             |
| Download signed document           | Yes, only for completed submissions with provider document URLs |

Retained-resource semantics: Alchemy `reconcile` creates once and returns cached output on subsequent plans; provider `list` returns `[]`; `nuke` is skipped. Create is a single submission POST, so there is no multi-step rollback sequence to compensate after a partial provider workflow.

## Example

```ts
import * as Alchemy from "alchemy";
import {
  DocuSealSignatureRequest,
  downloadDocuSealSignedDocument,
  providers as docusealProviders,
  type DocuSealProviderOptions,
} from "@signature-kit/docuseal";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Layer, Redacted } from "effect";

declare const pdfBase64: string;
declare const apiKey: string;

const options: DocuSealProviderOptions = {
  apiKey: Redacted.make(apiKey),
};

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(docusealProviders(options), signatureHttpClientLive),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* DocuSealSignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [
        { fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 },
      ],
      recipients: [{ name: "Ada Lovelace", email: "ada@example.com", role: "signer" }],
      send: true,
    });
  }),
) {}

export const downloadSigned = (id: string) =>
  downloadDocuSealSignedDocument(options, id).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

Invalid inputs, remote HTTP failures, unsupported operations, and invalid response shapes fail as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `errorMessage` from `@signature-kit/i18n` with the `signatureKitErrorMessages` catalog from `@signature-kit/signatures`.

Docs: <https://signaturekit.dev/en-US/docs/providers/docuseal>.

## License

MIT. See `LICENSE`.
