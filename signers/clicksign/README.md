# @signature-kit/clicksign

Alchemy v2 remote-signature provider for Clicksign document creation, lookup, listing, cancellation, deletion, and signed-file download.

## Install

```sh
bun add @signature-kit/clicksign @signature-kit/http effect alchemy
```

`effect` and `alchemy` are direct runtime dependencies. Provide
`signatureHttpClientLive` at the stack boundary; `providers(options)` supplies
only Clicksign credentials and resource providers. Provider options are stored as
a cached credential Effect, so retained `list` hooks and `read` calls without
cached output do not decode credentials.

## Public surface

- `@signature-kit/clicksign` — Clicksign request/document/signer schemas, `ClicksignSignatureRequest`, `ClicksignProviders`, `providers`, `getClicksignSignatureRequest`, `listClicksignSignatureRequests`, `cancelClicksignSignatureRequest`, `deleteClicksignSignatureRequest`, and `downloadClicksignSignedDocument`.

Capability matrix:

| Capability                      | Supported                                          |
| ------------------------------- | -------------------------------------------------- |
| Create retained Alchemy request | Yes                                                |
| Get request                     | Yes                                                |
| List requests                   | Yes                                                |
| Cancel request                  | Yes, via `PATCH /documents/{key}/cancel`           |
| Delete request                  | Yes                                                |
| Download signed document        | Yes, only when Clicksign exposes a signed-file URL |

Retained-resource semantics: Alchemy `reconcile` creates once and returns cached output on subsequent plans; provider `list` returns `[]`; `nuke` is skipped. Multi-step create rollback deletes remote state only after unambiguous pre-effect 4xx failures, excluding 408, 409, 429, 5xx, timeouts, and response-shape failures.

## Example

```ts
import * as Alchemy from "alchemy";
import {
  ClicksignSignatureRequest,
  cancelClicksignSignatureRequest,
  providers as clicksignProviders,
  type ClicksignProviderOptions,
} from "@signature-kit/clicksign";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Layer, Redacted } from "effect";

declare const pdfBase64: string;
declare const accessToken: string;

const options: ClicksignProviderOptions = {
  accessToken: Redacted.make(accessToken),
  environment: "sandbox",
  locale: "pt-BR",
  autoClose: true,
};

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(clicksignProviders(options), signatureHttpClientLive),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* ClicksignSignatureRequest("service-agreement", {
      title: "Service agreement",
      message: "Review and sign this document.",
      documents: [
        { fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 },
      ],
      recipients: [{ name: "Ada Lovelace", email: "ada@example.com", role: "signer" }],
      send: true,
    });
  }),
) {}

export const cancelRequest = (id: string) =>
  cancelClicksignSignatureRequest(options, id).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

Invalid inputs, remote HTTP failures, unsupported operations, and invalid response shapes fail as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `errorMessage` from `@signature-kit/i18n` with the `signatureKitErrorMessages` catalog from `@signature-kit/signatures`.

Docs: <https://signaturekit.dev/en-US/docs/providers/clicksign>.

## License

MIT. See `LICENSE`.
