import type { SVGProps } from "react";

/**
 * The real Montte mark (sourced from montte-nx favicon.svg). The three brand
 * facets map to `currentColor` at descending opacities, so the geometric depth
 * survives while staying monochrome with the rest of the site. Scales by its
 * 1987×1278 viewBox; pass `className` to size it.
 */
export function MontteLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 1987 1278"
      fill="none"
      role="img"
      aria-label="Montte"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M455.313 377.152L0.812988 1275.15L904.813 1276.15L455.313 377.152Z" fill="currentColor" fillOpacity="0.55" />
      <path d="M1613.81 1276.15L995.313 1276.65L681.813 656.152L682.313 655.152L994.313 1.15186L1614.81 1276.15H1613.81Z" fill="currentColor" />
      <path d="M1394.81 655.152L1533.31 376.652L1985.8 1276.15H1701.81L1394.81 655.152Z" fill="currentColor" fillOpacity="0.78" />
    </svg>
  );
}
