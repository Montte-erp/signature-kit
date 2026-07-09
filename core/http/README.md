# @signature-kit/http

Effect-native HTTP transport seam for remote signature providers and validators, with typed request schemas, timeout handling, response decoding, retry metadata, and redacted diagnostic URLs.

## Install

```sh
bun add @signature-kit/http @signature-kit/signatures effect
```

`effect` is a direct runtime dependency. Provider packages depend on this service contract but do not provide the live transport inside their provider layers.

## Public surface

- `@signature-kit/http` — `SignatureHttpMethodSchema`, `SignatureHttpHeadersSchema`, `SignatureHttpBodySchema`, `SignatureHttpRequestSchema`, `SignatureHttpClient`, `SignatureHttpClientService`, `signatureHttpClientLive`, `bearerAuthorization`, and `normalizedBaseUrl`.

`SignatureHttpRequest` fields are `method`, `url`, optional `provider`, optional `headers`, optional `diagnosticUrl`, optional `body`, optional `acceptedStatuses`, and optional `timeoutMillis`. `requestJson(request, schema, schemaName)` decodes JSON at the HTTP seam; `requestBytes` and `requestVoid` cover binary downloads and no-body operations.

Retry metadata is conservative: `GET`, `PUT`, and `DELETE` failures are marked retryable; `POST` and `PATCH` are not. HTTP 429 is always retryable regardless of method; 5xx is retryable only when the method itself is retryable. Other statuses, including 408, are not retryable. When a rate-limited response carries a reset time, the `x-ratelimit-reset` header is read before `Retry-After`, and the result is preserved as `retryAfterEpochSeconds`.

The timeout owns the complete fetch-and-body lifecycle. Interruption aborts the active request, and slow response bodies cannot outlive `timeoutMillis`.

Redaction rule: if credentials must appear in a transport URL, pass a credential-free `diagnosticUrl`; `SignatureKitError.reason` only uses the diagnostic URL.

Body contract: `SignatureHttpBodySchema` accepts `string | FormData | URLSearchParams`; multipart/form-data requests are sent via `FormData`.

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
