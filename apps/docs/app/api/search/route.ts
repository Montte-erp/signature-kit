import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Local Orama search index — powers the ⌘K command palette. Per-locale indexes
// with the matching stemmer so pt-BR queries tokenize correctly.
export const { GET } = createFromSource(source, {
  localeMap: {
    "en-US": "english",
    "pt-BR": "portuguese",
  },
});
