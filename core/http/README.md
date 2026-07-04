# @signature-kit/http

Effect-native HTTP transport seam for remote signature providers and validators, with typed request schemas, timeout handling, response decoding, retry metadata, and redacted diagnostic URLs.

## Install

```sh
bun add @signature-kit/http @signature-kit/signatures effect
```

`effect` is the runtime peer. Provider packages depend on this service contract but do not provide the live transport inside their provider layers.

## Public surface

- `@signature-kit/http` — `SignatureHttpMethodSchema`, `SignatureHttpHeadersSchema`, `SignatureHttpBodySchema`, `SignatureHttpRequestSchema`, `SignatureHttpClient`, `SignatureHttpClientService`, `signatureHttpClientLive`, `bearerAuthorization`, and `normalizedBaseUrl`.

`SignatureHttpRequest` fields are `method`, `url`, optional `provider`, optional `headers`, optional `diagnosticUrl`, optional `body`, optional `acceptedStatuses`, and optional `timeoutMillis`. `requestJson(request, schema, schemaName)` decodes JSON at the HTTP seam; `requestBytes` and `requestVoid` cover binary downloads and no-body operations.

Retry metadata is conservative: `GET`, `PUT`, and `DELETE` failures are marked retryable; `POST` and `PATCH` are not. HTTP 408, 429, and 5xx are retryable only when the method is retryable. `Retry-After` is preserved as `retryAfterEpochSeconds` when it can be parsed.

Redaction rule: if credentials must appear in a transport URL, pass a credential-free `diagnosticUrl`; `SignatureKitError.reason` only uses the diagnostic URL.

Multipart note: the current body contract is `string | Uint8Array`. If a provider needs multipart/form-data, extend `SignatureHttpBodySchema` with a typed multipart variant at this seam instead of bypassing `SignatureHttpClient`.

## Example

```ts
import {
  SignatureHttpClient,
  bearerAuthorization,
  signatureHttpClientLive,
} from "@signature-kit/http";
import { Effect, Redacted, Schema } from "effect";

const PingResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

const program = Effect.gen(function* () {
  const http = yield* SignatureHttpClient;
  return yield* http.requestJson(
    {
      provider: "example",
      method: "GET",
      url: "https://api.example.test/ping?token=secret",
      diagnosticUrl: "https://api.example.test/ping?token=<redacted>",
      headers: { authorization: bearerAuthorization(Redacted.make("secret")) },
      acceptedStatuses: [200],
      timeoutMillis: 10_000,
    },
    PingResponseSchema,
    "PingResponse",
  );
}).pipe(Effect.provide(signatureHttpClientLive));
```

## Errors and i18n

Transport faults, status failures, response-shape failures, timeout metadata, and schema names are mapped to `SignatureKitError` from `@signature-kit/signatures`. Applications can render localized copy through `@signature-kit/i18n` with `signatureKitErrorMessages`.

Docs: <https://signaturekit.dev/en-US/docs/concepts/effect-runtime>.

## License

MIT. See `LICENSE`.
