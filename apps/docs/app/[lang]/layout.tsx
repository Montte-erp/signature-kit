import "../global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocaleProvider } from "@/components/locale-provider";
import { setServerLocale } from "@/lib/server-locale";
import { i18n, provider } from "@/lib/i18n";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { parseLocale } from "@/lib/locale";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: `%s | ${SITE_NAME}`,
    default: "SignatureKit — Effect-native digital signatures for TypeScript",
  },
  description:
    "One typed signing boundary for A1/PKCS#12 certificates, PDF (PAdES), XML-DSig, and remote providers. Sign in the browser or on the server, with typed errors and Redacted secrets. A Montte product.",
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
};

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

/**
 * Root layout (the `[lang]` segment owns `<html>` — there is no `app/layout.tsx`;
 * every route lives under a locale prefix). Primes the request locale from the
 * route param for both Paraglide runtimes, applies Inter (sans) + Geist Mono
 * (mono), and enables the light/dark toggle via the default next-themes provider.
 */
export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const parsed = parseLocale(lang);
  if (parsed === undefined) notFound();
  const locale = setServerLocale(parsed);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen font-sans antialiased">
        <LocaleProvider locale={locale}>
          <RootProvider i18n={provider(locale)}>{children}</RootProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
