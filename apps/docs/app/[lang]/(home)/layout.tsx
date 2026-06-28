import { notFound } from "next/navigation";
import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";
import { Footer } from "@/components/sections/footer";
import { ReducedMotionProvider } from "@/components/reduced-motion-provider";
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale } from "@/lib/locale";
import { SITE_NAME } from "@/lib/site";

export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  // Prime the request locale before rendering the brand nav and footer.
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  const layoutOptions = baseOptions(locale);

  return (
    <ReducedMotionProvider>
      <HomeLayout
        {...layoutOptions}
        i18n={false}
        links={[]}
        nav={{
          ...layoutOptions.nav,
          component: (
            <header
              id="nd-nav"
              className="sticky top-0 z-40 h-14 border-b bg-background/80 px-4 backdrop-blur-lg"
            >
              <nav
                aria-label={SITE_NAME}
                className="flex h-full w-full items-center justify-center"
              >
                <Link
                  href={`/${locale}`}
                  className="text-sm font-semibold tracking-tight text-foreground"
                >
                  {SITE_NAME}
                </Link>
              </nav>
            </header>
          ),
        }}
        searchToggle={{ enabled: false }}
        themeSwitch={{ enabled: false }}
      >
        {children}
        <Footer />
      </HomeLayout>
    </ReducedMotionProvider>
  );
}
