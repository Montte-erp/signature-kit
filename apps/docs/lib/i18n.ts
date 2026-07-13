import type { TranslationsAPI } from "fumadocs-core/i18n";
import { defineI18n } from "fumadocs-core/i18n";
import { uiTranslations } from "fumadocs-ui/i18n";

import { baseLocale, locales } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";

export const i18n = defineI18n({
  defaultLanguage: baseLocale,
  languages: locales.map((locale) => locale),
  hideLocale: "never",
});

export const localizedPath = (path: string, locale: Locale): string =>
  `/${locale}${path === "/" ? "" : path.startsWith("/") ? path : `/${path}`}`;

export const localizedPaths = (path: string) =>
  i18n.languages.map((locale) => ({
    locale,
    path: localizedPath(path, locale),
  }));

export const signFreePath = "/assine-documentos-gratis";
export const signFreeLocales = i18n.languages.filter((locale) => locale === "pt-BR");

export const translations: TranslationsAPI<Locale> = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    "en-US": { displayName: "English" },
    "pt-BR": {
      displayName: "Português (Brasil)",
      "Back to Home(404 page)": "Voltar ao início",
      "Choose a language(language switcher)": "Escolher idioma",
      "Choose a language(language switcher)(aria-label)": "Escolher idioma",
      "Close Banner(banner)(aria-label)": "Fechar aviso",
      "Close Search(search dialog)(aria-label)": "Fechar busca",
      "Collapse Sidebar(sidebar)(aria-label)": "Recolher menu lateral",
      "Copied Text(code block)(aria-label)": "Texto copiado",
      "Copy Anchor Link(heading anchor)(aria-label)": "Copiar link da seção",
      "Copy Link(accordion)(aria-label)": "Copiar link",
      "Copy Markdown(page actions)": "Copiar Markdown",
      "Copy Text(code block)(aria-label)": "Copiar texto",
      "Dark(theme switcher)(aria-label)": "Escuro",
      "Default(type table)": "Padrão",
      "Edit on GitHub(edit page)": "Editar no GitHub",
      "Last updated on(page footer)": "Última atualização em",
      "Light(theme switcher)(aria-label)": "Claro",
      "Next Page(pagination)": "Próxima página",
      "No Headings(table of contents)": "Sem títulos",
      "No results found(search dialog)": "Nenhum resultado encontrado",
      "On this page(table of contents)": "Nesta página",
      "Open Search(search trigger)(aria-label)": "Abrir busca",
      "Open Sidebar(sidebar)(aria-label)": "Abrir menu lateral",
      "Open in ChatGPT(page actions)": "Abrir no ChatGPT",
      "Open in Claude(page actions)": "Abrir no Claude",
      "Open in Cursor(page actions)": "Abrir no Cursor",
      "Open in GitHub(page actions)": "Abrir no GitHub",
      "Open in Scira AI(page actions)": "Abrir no Scira AI",
      "Open(page actions)": "Abrir",
      "Page Not Found(404 page)": "Página não encontrada",
      "Parameters(type table)": "Parâmetros",
      "Previous Page(pagination)": "Página anterior",
      "Prop(type table)": "Propriedade",
      "Read {url}, I want to ask questions about it.(page actions)":
        "Leia {url}, quero fazer perguntas sobre o conteúdo.",
      "Returns(type table)": "Retorna",
      "Search(search dialog)": "Buscar",
      "Search(search trigger)": "Buscar",
      "System(theme switcher)(aria-label)": "Sistema",
      "Table of Contents(inline table of contents)": "Conteúdo",
      "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)":
        "A página que você procura pode ter sido removida, teve o nome alterado ou está temporariamente indisponível.",
      "Toggle Menu(mobile menu)(aria-label)": "Alternar menu",
      "Toggle Theme(theme switcher)(aria-label)": "Alternar tema",
      "Type(type table)": "Tipo",
      "View as Markdown(page actions)": "Ver como Markdown",
    },
  });
