import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/logo";
import type { Lang } from "@/lib/locale";
import { SITE_NAME } from "@/lib/site";

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
    themeSwitch: { mode: "light-dark" },
  };
}
