# @signature-kit/react

Headless React hooks for browser A1 certificate loading, A1 PDF signing, external builder state, and PDF object URLs.

The package is intentionally hooks-only. It does not publish UI components, storage, fetch/tRPC glue, toasts, modals, rendering adapters, or `react-pdf` bindings. Apps own UI code directly or install the docs-hosted shadcn registry components into their own source tree.

## Install

```sh
bun add @signature-kit/react @signature-kit/a1 @signature-kit/pdf effect react react-dom
```

React is a peer dependency. `effect` is the runtime peer used by the hook actions.

Install the docs-hosted shadcn dialog into your app when you want owned UI:

```sh
npx shadcn@latest add https://signaturekit.dev/r/signature-dialog.json
```

Migration note: components moved out of the npm package and into the registry. Replace old `@signature-kit/react/components` imports with app-owned registry files.

## Public surface

- `@signature-kit/react/a1` — `useA1Certificate`, `useA1Signer`, `getLoadedA1CertificateProfile`, and clear actions.
- `@signature-kit/react/browser-pdf` — `usePdfObjectUrl(bytes)` with object URL cleanup.
- `@signature-kit/react/builder` — tiny external-store helpers for headless builder state.
- `@signature-kit/react/config` — hook input schemas, signer row types, certificate state types, and builder store contracts.

Certificate persistence is not included. If an app remembers a password or encrypted PFX bytes, it owns that storage policy and passes fresh inputs back to the hooks.

## Example

```tsx
import { useA1Certificate, useA1Signer } from "@signature-kit/react/a1";

type Props = {
  readonly pdf: Uint8Array;
  readonly pfx: Uint8Array;
  readonly password: string;
};

export function SignWithA1({ pdf, pfx, password }: Props) {
  const certificate = useA1Certificate();
  const signer = useA1Signer();

  return (
    <button
      type="button"
      disabled={certificate.status === "loading" || signer.busy}
      onClick={async () => {
        const loaded = await certificate.load(pfx, password);
        if (!loaded.ok) return;

        await signer.sign({
          documents: [{ id: "contract", name: "contract.pdf", pdf }],
          credentials: { profile: loaded.profile },
          signing: { policy: "pades-icp-brasil" },
        });
      }}
    >
      Sign PDF
    </button>
  );
}
```

## Errors and i18n

Hook failures return typed `SignatureKitError`, `PdfError`, or `CmsError` values in the hook outcome/state. Applications can render localized copy through `@signature-kit/i18n` with the relevant package catalogs.

Docs: <https://signaturekit.dev/en-US/docs/a1-signing/browser-pdf-flow> and <https://signaturekit.dev/en-US/docs/recipes/react-components>.

## License

MIT. See `LICENSE`.
