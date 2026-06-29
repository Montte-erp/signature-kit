import type { SVGProps } from "react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { MontteLogo } from "@/components/brand/montte-logo";
import { Button } from "@/components/ui/button";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

/** GitHub mark — lucide-react dropped its brand icons, so inline the octocat. */
const GithubMark = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.33-1.74-1.33-1.74-1.09-.73.08-.71.08-.71 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.29-1.53 3.3-1.21 3.3-1.21.66 1.65.24 2.87.12 3.17.77.83 1.24 1.88 1.24 3.17 0 4.53-2.8 5.53-5.48 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
  </svg>
);

/**
 * Landing footer — restrained: the brand cell (logo + short blurb + GitHub),
 * two tight link groups, and a bottom bar with the Montte attribution. No
 * provider link farm; the docs sidebar owns per-provider nav. Pure-monochrome
 * shadcn tokens, server component, every href a real route or honest URL.
 */

const GITHUB_URL = "https://github.com/Montte-erp/signature-kit";

const DOCS_LINKS: ReadonlyArray<{ readonly href: string; readonly label: () => string }> = [
  { href: "/docs/get-started/quickstart", label: m.footer_link_quickstart },
  { href: "/docs/signing/signers", label: m.footer_link_signing_boundary },
  { href: "/docs/signing/pdf", label: m.footer_link_pdf },
  { href: "/docs/signing/xml", label: m.footer_link_xml },
  { href: "/docs/signing/errors", label: m.footer_link_errors },
];

const PROJECT_LINKS: ReadonlyArray<{
  readonly external?: boolean;
  readonly href: string;
  readonly label: () => string;
}> = [
  { href: "/docs/providers/request-shape", label: m.footer_col_providers },
  { href: "/blog", label: m.footer_link_blog },
  { external: true, href: GITHUB_URL, label: m.footer_link_github },
  { external: true, href: `${GITHUB_URL}/issues`, label: m.footer_link_issues },
];

const COLUMN_HEADER_CLASS =
  "font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-muted-foreground/70";

interface FooterLinkProps {
  href: string;
  external?: boolean;
  children: string;
}

const FooterLink = ({ href, external, children }: FooterLinkProps) =>
  external ? (
    <a
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ) : (
    <Link
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      href={localePath(href)}
    >
      {children}
    </Link>
  );

interface FooterColumn {
  readonly header: string;
  readonly links: readonly { href: string; external?: boolean; label: () => string }[];
}

const FooterColumn = ({ header, links }: FooterColumn) => (
  <div className="flex flex-col gap-3">
    <p className={COLUMN_HEADER_CLASS}>{header}</p>
    <ul className="flex flex-col gap-2.5">
      {links.map(({ href, external, label }) => (
        <li key={href}>
          <FooterLink href={href} external={external}>
            {label()}
          </FooterLink>
        </li>
      ))}
    </ul>
  </div>
);

export const Footer = () => (
  <footer className="border-t border-border">
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-xs flex-col items-start gap-4">
          <div className="flex items-center gap-2">
            <Logo className="size-4 text-foreground" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              SignatureKit
            </span>
          </div>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {m.footer_brand_blurb()}
          </p>
          <Button asChild size="icon" variant="outline">
            <a aria-label="GitHub" href={GITHUB_URL} rel="noreferrer" target="_blank">
              <GithubMark />
            </a>
          </Button>
        </div>

        <div className="flex gap-16 sm:gap-24">
          <FooterColumn header={m.footer_col_docs()} links={DOCS_LINKS} />
          <FooterColumn header={m.footer_col_project()} links={PROJECT_LINKS} />
        </div>
      </div>

      <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {m.footer_attribution_prefix()}{" "}
          <a
            aria-label="Montte"
            className="inline-flex items-center gap-1.5 align-baseline text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-foreground"
            href="https://montte.co"
            rel="noreferrer"
            target="_blank"
            title="Montte"
          >
            <MontteLogo className="h-3 w-auto" />
            Montte
          </a>
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {m.footer_copyright()}
        </p>
      </div>
    </div>
  </footer>
);
