import { Signature, type LucideProps } from "lucide-react";

/**
 * SignatureKit mark — lucide's `Signature` glyph (a signing flourish). Uses
 * currentColor so it inherits the foreground wherever it renders (nav, footer, …).
 */
export function Logo(props: LucideProps) {
  return <Signature aria-hidden {...props} />;
}
