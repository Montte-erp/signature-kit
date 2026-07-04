# @signature-kit/assinafy

Alchemy v2 remote-signature provider for Assinafy request creation, lookup, listing, deletion, and completed-document download.

## Install

```sh
bun add @signature-kit/assinafy @signature-kit/http effect alchemy
```

`effect` and `alchemy` are runtime peers. Provide `signatureHttpClientLive` at the stack boundary; `providers(options)` supplies only Assinafy credentials and resource providers.

## Public surface

- `@signature-kit/assinafy` — Assinafy request/document/signer schemas, `AssinafySignatureRequest`, `AssinafyProviders`, `providers`, `getAssinafySignatureRequest`, `listAssinafySignatureRequests`, `deleteAssinafySignatureRequest`, and `downloadAssinafySignedDocument`.

Capability matrix:

| Capability                      | Supported                                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| Create retained Alchemy request | Yes                                                                |
| Get request                     | Yes                                                                |
| List requests                   | Yes                                                                |
| Cancel request                  | No public Assinafy cancel endpoint is exposed                      |
| Delete request                  | Yes                                                                |
| Download signed document        | Yes, only after the provider exposes a completed download artifact |

Retained-resource semantics: Alchemy `reconcile` creates once and returns cached output on subsequent plans; provider `list` returns `[]`; `nuke` is skipped. Multi-step create rollback deletes remote state only after unambiguous pre-effect 4xx failures, excluding 408, 409, 429, 5xx, timeouts, and response-shape failures.

## Example

```ts
import * as Alchemy from "alchemy";
import {
  AssinafySignatureRequest,
  downloadAssinafySignedDocument,
  providers as assinafyProviders,
  type AssinafyProviderOptions,
} from "@signature-kit/assinafy";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Layer, Redacted } from "effect";

declare const pdfBase64: string;
declare const apiKey: string;
declare const accountId: string;

const options: AssinafyProviderOptions = {
  accountId,
  apiKey: Redacted.make(apiKey),
  environment: "sandbox",
};

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(assinafyProviders(options), signatureHttpClientLive),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* AssinafySignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [
        { fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 },
      ],
      recipients: [{ name: "Ada Lovelace", email: "ada@example.com" }],
      send: true,
    });
  }),
) {}

export const downloadSigned = (id: string) =>
  downloadAssinafySignedDocument(options, id).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

Invalid inputs, remote HTTP failures, unsupported operations, and invalid response shapes fail as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/providers/assinafy>.

## License

MIT. See `LICENSE`.
