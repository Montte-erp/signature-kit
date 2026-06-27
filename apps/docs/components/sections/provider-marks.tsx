import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Shared remote-signer brand data + a single logo chip. Consumed by the
 * providers showcase (`brandLogoUrl`) and the integrations marquee (`PROVIDERS`
 * + `LogoPill`). Pure-monochrome: every logo is greyscaled, never the brand hex.
 */

export interface Brand {
  readonly name: string;
  /** Domain used to resolve the real logo (Google S2 favicons). */
  readonly domain: string;
}

/** The remote signature providers SignatureKit ships an adapter for. */
export const PROVIDERS: readonly Brand[] = [
  { name: "Clicksign", domain: "clicksign.com" },
  { name: "Assinafy", domain: "assinafy.com.br" },
  { name: "ZapSign", domain: "zapsign.co" },
  { name: "DocuSeal", domain: "docuseal.com" },
  { name: "Documenso", domain: "documenso.com" },
];

/**
 * A real brand logo URL resolved from Google's S2 favicon service by domain.
 * Unlike logo.dev (needs a token) or DuckDuckGo (frequently 404s), this endpoint
 * always returns an icon; a CSS grayscale filter keeps the row pure-monochrome.
 */
export const brandLogoUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

/**
 * A brand fronted by its real (greyscaled) logo in a bordered shadcn pill. The
 * label always renders, so a 404 logo degrades to the word-mark, never a broken
 * image. `group` drives the logo's hover de-saturation lift.
 */
export function LogoPill({ brand, className }: { brand: Brand; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "group gap-2 px-4 py-2 font-mono whitespace-nowrap text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brandLogoUrl(brand.domain)}
        alt=""
        aria-hidden
        width={16}
        height={16}
        loading="lazy"
        className="size-4 shrink-0 rounded-[3px] object-contain opacity-70 grayscale transition group-hover:opacity-100"
      />
      {brand.name}
    </Badge>
  );
}
