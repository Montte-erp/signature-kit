import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages";
import type { Lang } from "@/lib/locale";
import { appName } from "./shared";

/**
 * Shared nav/layout options, locale-aware. Internal URLs carry the active
 * `[lang]` prefix so the nav never bounces through the proxy's Accept-Language
 * redirect. The nav floats transparently at the top of the page and gains a
 * solid background once scrolled. The language switcher is the Fumadocs
 * built-in (rendered from the i18n context), and the theme toggle is enabled
 * (light + dark).
 */
export function baseOptions(lang: Lang): BaseLayoutProps {
  return {
    nav: {
      url: `/${lang}`,
      transparentMode: "top",
      title: (
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="grid size-6 place-items-center rounded-md border border-border bg-input/30">
            <Logo className="size-3.5" />
          </span>
          <span className="font-medium tracking-tight">{appName}</span>
        </div>
      ),
    },
    // A single clean sun/moon toggle — not the default 3-way light/dark/system
    // segmented control, which renders cramped in the sidebar footer.
    themeSwitch: { mode: "light-dark" },
    links: [
      {
        type: "custom",
        secondary: true,
        children: (
          <Button asChild size="sm">
            <Link href={`/${lang}/docs/quickstart`}>{m.nav_get_started()}</Link>
          </Button>
        ),
      },
    ],
  };
}
