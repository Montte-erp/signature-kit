import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/logo";
import type { Lang } from "@/lib/locale";
import { SITE_NAME } from "@/lib/site";

/**
 * Shared nav/layout options, locale-aware. Internal URLs carry the active
 * `[lang]` prefix so the nav never bounces through the proxy's Accept-Language
 * redirect. Documentation pages keep the Fumadocs search, language switcher,
 * and theme toggle; the landing page overrides this with a quieter brand-only
 * header.
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
          <span className="font-medium tracking-tight">{SITE_NAME}</span>
        </div>
      ),
    },
    // A single clean sun/moon toggle — not the default 3-way light/dark/system
    // segmented control, which renders cramped in the sidebar footer.
    themeSwitch: { mode: "light-dark" },
  };
}
