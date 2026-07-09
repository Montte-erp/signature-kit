# @signature-kit/zapsign

Alchemy v2 remote-signature provider for ZapSign single-PDF document creation, lookup, listing, cancellation, deletion, and signed-file download.

## Install

```sh
bun add @signature-kit/zapsign @signature-kit/http effect alchemy
```

`effect` and `alchemy` are direct runtime dependencies. Provide
`signatureHttpClientLive` at the stack boundary; `providers(options)` supplies
only ZapSign credentials and resource providers. Provider options are stored as
a cached credential Effect, so retained `list` hooks and `read` calls without
cached output do not decode credentials.

## Public surface

- `@signature-kit/zapsign` — ZapSign document/signer schemas, `ZapSignSignatureRequest`, `providers`, `getZapSignSignatureRequest`, `listZapSignSignatureRequests`, `cancelZapSignSignatureRequest`, `deleteZapSignSignatureRequest`, and `downloadZapSignSignedDocument`.

Capability matrix:

| Capability                       | Supported                                        |
| -------------------------------- | ------------------------------------------------ |
| Create retained Alchemy document | Yes, single PDF only                             |
| Get document                     | Yes                                              |
| List documents                   | Yes                                              |
| Cancel document                  | Yes                                              |
| Delete document                  | Yes                                              |
| Download signed document         | Yes, only when ZapSign exposes a signed-file URL |

Retained-resource semantics: Alchemy `reconcile` creates once and returns cached output on subsequent plans; provider `list` returns `[]`; `nuke` is skipped. Create is a single document POST, so there is no multi-step rollback sequence to compensate after a partial provider workflow. The local schema enforces the single-PDF `application/pdf` input shape.

## Example

```ts
import * as Alchemy from "alchemy";
import {
  ZapSignSignatureRequest,
  cancelZapSignSignatureRequest,
  providers as zapsignProviders,
  type ZapSignProviderOptions,
} from "@signature-kit/zapsign";
import { signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Layer, Redacted } from "effect";

declare const pdfBase64: string;
declare const apiToken: string;

const options: ZapSignProviderOptions = {
  apiToken: Redacted.make(apiToken),
  environment: "sandbox",
};

export default class Contracts extends Alchemy.Stack<Contracts>()(
  "Contracts",
  {
    providers: Layer.merge(zapsignProviders(options), signatureHttpClientLive),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    return yield* ZapSignSignatureRequest("service-agreement", {
      title: "Service agreement",
      documents: [
        { fileName: "contract.pdf", mimeType: "application/pdf", contentBase64: pdfBase64 },
      ],
      recipients: [{ name: "Ada Lovelace", email: "ada@example.com" }],
      send: true,
    });
  }),
) {}

export const cancelRequest = (id: string) =>
  cancelZapSignSignatureRequest(options, id).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

Invalid inputs, remote HTTP failures, unsupported operations, and invalid response shapes fail as `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `errorMessage` from `@signature-kit/i18n` with the `signatureKitErrorMessages` catalog from `@signature-kit/signatures`.

Docs: <https://signaturekit.dev/en-US/docs/providers/zapsign>.

## License

MIT. See `LICENSE`.
