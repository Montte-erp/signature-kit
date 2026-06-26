import { siBun, siNodedotjs, siReact, siTypescript } from "simple-icons";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { m } from "@/paraglide/messages";
import { cn } from "@/lib/utils";

/**
 * Shape of a `simple-icons` export — `{ title, slug, hex, path }`, where `path`
 * is a single 24×24 SVG path. We deliberately ignore `hex`: every mark renders
 * in `currentColor` to stay pure monochrome and avoid implying endorsement.
 */
interface SimpleIcon {
  title: string;
  path: string;
}

/**
 * The open-source stack SignatureKit is genuinely built on. These ship as crisp
 * monochrome vector logos via `simple-icons` (best quality, no network).
 */
const BUILT_ON: readonly SimpleIcon[] = [siTypescript, siReact, siNodedotjs, siBun];

interface Brand {
  readonly name: string;
  /** Domain used to resolve a real logo (Google S2 favicons). */
  readonly domain: string;
}

/** Effect — the core SignatureKit is built on — rendered from its real logo. */
const BUILT_ON_BRANDS: readonly Brand[] = [{ name: "Effect", domain: "effect.website" }];

/** A standard that has a real mark (the Brazilian PKI / gov.br). */
const SUPPORTED_BRANDS: readonly Brand[] = [{ name: "ICP-Brasil", domain: "gov.br" }];

/** Pure formats/standards with no brand logo — honest word-marks. */
const SUPPORTED_STANDARDS = ["A1 / PKCS#12", "PDF · PAdES", "XML-DSig"] as const;

/** Remote signature providers — their real brand logos when a domain has one. */
export const PROVIDERS: readonly Brand[] = [
  { name: "DocuSign", domain: "docusign.com" },
  { name: "Clicksign", domain: "clicksign.com" },
  { name: "Assinafy", domain: "assinafy.com.br" },
  { name: "ZapSign", domain: "zapsign.co" },
  { name: "DocuSeal", domain: "docuseal.com" },
  { name: "Adobe Acrobat Sign", domain: "adobe.com" },
  { name: "Dropbox Sign", domain: "dropboxsign.com" },
  { name: "Documenso", domain: "documenso.com" },
];

/**
 * A real brand logo URL, resolved from Google's S2 favicon service by domain.
 * Unlike logo.dev (needs a token) or DuckDuckGo (frequently 404s — e.g. adobe.com),
 * this endpoint always returns an icon, so every brand shows a real mark. A CSS
 * grayscale filter keeps the row pure-monochrome; the onError→initial fallback in
 * the consumers stays as a genuine-404 last resort.
 */
export const brandLogoUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

/** Flat list kept for any external consumers / tests. */
export const PROVIDER_MARKS = [
  ...BUILT_ON.map((icon) => icon.title),
  ...BUILT_ON_BRANDS.map((brand) => brand.name),
  ...SUPPORTED_BRANDS.map((brand) => brand.name),
  ...SUPPORTED_STANDARDS,
  ...PROVIDERS.map((provider) => provider.name),
] as const;

interface BrandLogoProps {
  icon: SimpleIcon;
  className?: string;
}

/**
 * A single real logo rendered inline from a `simple-icons` path. Uses
 * `fill-current` so it inherits `currentColor` — strictly monochrome, never the
 * brand hex. The glyph is decorative; the surrounding pill carries the label.
 */
export function BrandLogo({ icon, className }: BrandLogoProps) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("size-4 shrink-0 fill-current", className)}>
      <path d={icon.path} />
    </svg>
  );
}

// Shared pill look layered on the shadcn <Badge variant="outline"> base
// (rounded-4xl border bg-input/30). `group` drives the logo hover.
const PILL =
  "group gap-2 px-4 py-2 font-mono whitespace-nowrap text-muted-foreground hover:text-foreground";

/** A `simple-icons` vector logo in the shared bordered pill. */
export function BrandPill({ icon, className }: BrandLogoProps) {
  return (
    <Badge variant="outline" className={cn(PILL, className)}>
      <BrandLogo icon={icon} />
      {icon.title}
    </Badge>
  );
}

/**
 * A brand pill fronted by its real (monochrome) logo from Google S2 favicons.
 * The label always renders, so a missing/404 logo degrades to the same word-mark
 * — never a broken image. The img is greyscaled to stay pure-monochrome.
 */
export function LogoPill({ brand, className }: { brand: Brand; className?: string }) {
  return (
    <Badge variant="outline" className={cn(PILL, className)}>
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

/** A single mono word-mark: bordered pill on the faint input surface. */
export function ProviderMark({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn(PILL, "gap-0", className)}>
      {label}
    </Badge>
  );
}

/** A small section caption ("Built on" / "Supports" / "Integrates with"). */
function MarqueeCaption({ label }: { label: string }) {
  return (
    <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
      {label}
    </span>
  );
}

/** Thin vertical divider between runs. */
function MarqueeDivider() {
  return <Separator orientation="vertical" className="h-5" />;
}

/**
 * Edge-masked, infinitely scrolling row. Three honest, captioned runs, every
 * brandable item fronted by its REAL logo (vector via simple-icons, or fetched
 * from Google S2 favicons and greyscaled); only the truly logo-less formats
 * (A1/PKCS#12, PDF·PAdES, XML-DSig) stay as word-marks. The sequence is doubled
 * so the CSS `marquee` keyframe (app/global.css, translates -50%) loops
 * seamlessly. Server component — pure CSS motion, no JS.
 */
export function ProviderMarquee({ className }: { className?: string }) {
  const sequence = [
    { key: "cap-built-on", node: <MarqueeCaption label={m.marquee_built_on()} /> },
    ...BUILT_ON.map((icon, i) => ({ key: `built-${icon.title}-${i}`, node: <BrandPill icon={icon} /> })),
    ...BUILT_ON_BRANDS.map((brand, i) => ({ key: `built-b-${brand.name}-${i}`, node: <LogoPill brand={brand} /> })),
    { key: "div-1", node: <MarqueeDivider /> },
    { key: "cap-supports", node: <MarqueeCaption label={m.marquee_supports()} /> },
    ...SUPPORTED_BRANDS.map((brand, i) => ({ key: `sup-b-${brand.name}-${i}`, node: <LogoPill brand={brand} /> })),
    ...SUPPORTED_STANDARDS.map((label, i) => ({ key: `sup-${label}-${i}`, node: <ProviderMark label={label} /> })),
    { key: "div-2", node: <MarqueeDivider /> },
    { key: "cap-integrates", node: <MarqueeCaption label={m.marquee_integrates()} /> },
    ...PROVIDERS.map((provider, i) => ({ key: `prov-${provider.name}-${i}`, node: <LogoPill brand={provider} /> })),
  ];

  // Doubled for the seamless marquee loop; prefix each half so every node keeps
  // a stable, position-independent key (no array-index keys).
  const items = [
    ...sequence.map((item) => ({ ...item, uid: `a-${item.key}`, dup: false })),
    ...sequence.map((item) => ({ ...item, uid: `b-${item.key}`, dup: true })),
  ];

  return (
    <div
      className={cn(
        "overflow-x-clip py-2 [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]",
        className,
      )}
    >
      <ul className="marquee-track flex w-max animate-[marquee_40s_linear_infinite] items-center gap-4 sm:gap-5">
        {items.map((item) => (
          <li key={item.uid} aria-hidden={item.dup}>
            {item.node}
          </li>
        ))}
      </ul>
    </div>
  );
}
