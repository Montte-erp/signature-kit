import { notFound } from "next/navigation";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";
import { Footer } from "@/components/sections/footer";
import { ReducedMotionProvider } from "@/components/reduced-motion-provider";
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale } from "@/lib/locale";

export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  // Prime the request locale before rendering the nav (baseOptions) + footer.
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  return (
    <ReducedMotionProvider>
      <HomeLayout {...baseOptions(locale)}>
        {children}
        <Footer />
      </HomeLayout>
    </ReducedMotionProvider>
  );
}
