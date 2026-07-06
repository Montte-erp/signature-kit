import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";


export interface Brand {
  readonly name: string;
  readonly domain: string;
}

export const PROVIDERS: readonly Brand[] = [
  { name: "Clicksign", domain: "clicksign.com" },
  { name: "Assinafy", domain: "assinafy.com.br" },
  { name: "ZapSign", domain: "zapsign.co" },
  { name: "DocuSeal", domain: "docuseal.com" },
  { name: "Documenso", domain: "documenso.com" },
];

export const brandLogoUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

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
