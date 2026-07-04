import { cmsErrorMessages } from "@signature-kit/cms/config";
import { pdfErrorMessages } from "@signature-kit/pdf/config";
import { signatureKitErrorCatalog } from "@signature-kit/signatures";
import { xmlErrorMessages } from "@signature-kit/xml/config";

type ErrorCatalogEntry = {
  readonly code: string;
  readonly message: string;
  readonly overridable?: boolean;
};

const entriesFromMessages = (
  messages: Readonly<Record<string, string>>,
): ReadonlyArray<ErrorCatalogEntry> =>
  Object.entries(messages).map(([code, message]) => ({ code, message }));

const errorCatalogs = {
  "signature-kit": signatureKitErrorCatalog,
  pdf: entriesFromMessages(pdfErrorMessages["en-US"]),
  xml: entriesFromMessages(xmlErrorMessages["en-US"]),
  cms: entriesFromMessages(cmsErrorMessages["en-US"]),
} satisfies Record<string, ReadonlyArray<ErrorCatalogEntry>>;

type ErrorCatalogFamily = keyof typeof errorCatalogs;

const familyPrefixes = {
  "signature-kit": "signature-kit",
  pdf: "pdf",
  xml: "xml",
  cms: "cms",
} satisfies Record<ErrorCatalogFamily, string>;

const familyLabels = {
  "signature-kit": "SignatureKitError",
  pdf: "PdfError",
  xml: "XmlError",
  cms: "CmsError",
} satisfies Record<ErrorCatalogFamily, string>;

type ErrorCatalogProps = {
  readonly family?: ErrorCatalogFamily;
  readonly editableLabel?: string;
};

/**
 * Renders a stable error-code catalog. Each row carries an anchor. The
 * `signature-kit` family preserves the historical `#err-WRONG_PASSWORD` shape;
 * format families include their prefix (`#err-pdf-SIGN_FAILED`) to avoid
 * collisions between `pdf.SIGN_FAILED`, `xml.SIGN_FAILED`, and `cms.SIGN_ERROR`.
 */
export function ErrorCatalog({
  family = "signature-kit",
  editableLabel = "editable",
}: ErrorCatalogProps) {
  const entries = errorCatalogs[family];
  const prefix = familyPrefixes[family];
  const anchorPrefix = family === "signature-kit" ? "err" : `err-${family}`;

  return (
    <div
      id={`${family}-error-catalog`}
      className="not-prose my-6 overflow-hidden rounded-lg border border-fd-border text-fd-foreground"
    >
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] border-b border-fd-border bg-fd-card px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground">
        <span>{familyLabels[family]} code</span>
        <span>Default message</span>
      </div>
      {entries.map((entry) => {
        const short = entry.code.startsWith(`${prefix}.`)
          ? entry.code.slice(prefix.length + 1)
          : entry.code;
        const id = `${anchorPrefix}-${short}`;
        return (
          <div
            key={entry.code}
            id={id}
            className="grid scroll-mt-24 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-fd-border px-4 py-2.5 last:border-0 target:bg-fd-primary/5"
          >
            <code className="font-mono text-xs">
              <span className="text-fd-muted-foreground/60">{prefix}.</span>
              <span className="text-fd-foreground">{short}</span>
            </code>
            <span className="text-xs leading-6 text-fd-muted-foreground">
              {entry.message}
              {entry.overridable === true && (
                <span className="ml-1 text-fd-muted-foreground/50">· {editableLabel}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
