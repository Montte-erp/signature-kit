import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";
import { Footer } from "@/components/sections/footer";
import { ReducedMotionProvider } from "@/components/reduced-motion-provider";
import { setServerLocale } from "@/lib/server-locale";
import type { Lang } from "@/lib/locale";

export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  // Prime the request locale before rendering the nav (baseOptions) + footer.
  setServerLocale(lang as Lang);

  return (
    <ReducedMotionProvider>
      <HomeLayout {...baseOptions(lang as Lang)}>
        {children}
        <Footer />
      </HomeLayout>
    </ReducedMotionProvider>
  );
}
