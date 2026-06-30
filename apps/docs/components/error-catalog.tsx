import { signatureKitErrorCatalog } from "@signature-kit/core/config";

/**
 * Renders the full `SignatureKitError` catalog. Each row carries a stable
 * `id="err-<CODE>"` anchor (e.g. `#err-WRONG_PASSWORD`) so other pages can deep
 * link to a specific code.
 */
export function ErrorCatalog() {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-fd-border text-fd-foreground">
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] border-b border-fd-border bg-fd-card px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground">
        <span>Code</span>
        <span>Default message</span>
      </div>
      {signatureKitErrorCatalog.map((entry) => {
        const id = entry.code.replace("signature-kit.", "err-");
        const short = entry.code.replace("signature-kit.", "");
        return (
          <div
            key={entry.code}
            id={id}
            className="grid scroll-mt-24 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-fd-border px-4 py-2.5 last:border-0 target:bg-fd-primary/5"
          >
            <code className="font-mono text-xs">
              <span className="text-fd-muted-foreground/60">signature-kit.</span>
              <span className="text-fd-foreground">{short}</span>
            </code>
            <span className="text-xs leading-6 text-fd-muted-foreground">
              {entry.message}
              {entry.overridable && (
                <span className="ml-1 text-fd-muted-foreground/50">· editable</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
