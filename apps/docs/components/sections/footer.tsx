import type { SVGProps } from "react";
import Link from "next/link";

import { Logo } from "@/components/logo";
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
 * Landing footer — a solid top border, the brand cell (shared Logo +
 * wordmark + blurb + GitHub action), a trio of link columns, then a bottom
 * bar carrying the required Montte attribution. Pure-monochrome shadcn tokens
 * only; no coral, no fd-* tokens.
 *
 * Server component — plain markup, no motion. Every href resolves to a real
 * /docs route or an honest external URL.
 */

const GITHUB_URL = "https://github.com/Montte-erp/signature-kit";

const DOCS_LINKS = [
  { href: "/docs/installation", label: m.footer_link_installation },
  { href: "/docs/quickstart", label: m.footer_link_quickstart },
  { href: "/docs/signers", label: m.footer_link_signing_boundary },
  { href: "/docs/pdf", label: m.footer_link_pdf },
  { href: "/docs/xml", label: m.footer_link_xml },
  { href: "/docs/errors", label: m.footer_link_errors },
];

const PROVIDER_LINKS = [
  { href: "/docs/providers/docusign", label: "DocuSign" },
  { href: "/docs/providers/clicksign", label: "Clicksign" },
  { href: "/docs/providers/assinafy", label: "Assinafy" },
  { href: "/docs/providers/zapsign", label: "ZapSign" },
  { href: "/docs/providers/docuseal", label: "DocuSeal" },
  { href: "/docs/providers/adobe-sign", label: "Adobe Sign" },
  { href: "/docs/providers/dropbox-sign", label: "Dropbox Sign" },
  { href: "/docs/providers/documenso", label: "Documenso" },
];

const PROJECT_LINKS = [
  {
    href: "/blog",
    label: m.footer_link_blog,
  },
  {
    external: true,
    href: GITHUB_URL,
    label: m.footer_link_github,
  },
  {
    external: true,
    href: `${GITHUB_URL}/issues`,
    label: m.footer_link_issues,
  },
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
      className="text-sm font-normal text-muted-foreground transition-colors hover:text-foreground"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ) : (
    <Link
      className="text-sm font-normal text-muted-foreground transition-colors hover:text-foreground"
      href={localePath(href)}
    >
      {children}
    </Link>
  );

export const Footer = () => (
  <footer className="border-t border-border">
    <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
      <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-4 lg:gap-x-16">
        <div className="col-span-2 flex flex-col gap-4 sm:col-span-1">
          <div className="flex items-center gap-2">
            <Logo className="size-4 text-foreground" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              SignatureKit
            </span>
          </div>
          <p className="max-w-[34ch] text-sm leading-relaxed text-pretty text-muted-foreground">
            {m.footer_brand_blurb()}
          </p>
          <Button asChild size="icon" variant="outline">
            <a
              aria-label="GitHub"
              href={GITHUB_URL}
              rel="noreferrer"
              target="_blank"
            >
              <GithubMark />
            </a>
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          <p className={COLUMN_HEADER_CLASS}>{m.footer_col_docs()}</p>
          <ul className="flex flex-col gap-2">
            {DOCS_LINKS.map(({ href, label }) => (
              <li key={href}>
                <FooterLink href={href}>{label()}</FooterLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <p className={COLUMN_HEADER_CLASS}>{m.footer_col_providers()}</p>
          <ul className="flex flex-col gap-2">
            {PROVIDER_LINKS.map(({ href, label }) => (
              <li key={href}>
                <FooterLink href={href}>{label}</FooterLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <p className={COLUMN_HEADER_CLASS}>{m.footer_col_project()}</p>
          <ul className="flex flex-col gap-2">
            {PROJECT_LINKS.map(({ external, href, label }) => (
              <li key={href}>
                <FooterLink external={external} href={href}>
                  {label()}
                </FooterLink>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {m.footer_attribution_prefix()}{" "}
          <a
            aria-label="Montte"
            className="align-baseline text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-foreground"
            href="https://github.com/Montte-erp"
            rel="noreferrer"
            target="_blank"
            title="Montte"
          >
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
