import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";
import { captureServerEvent } from "@/lib/posthog/server";

// Local Orama search index — powers the ⌘K command palette. Per-locale indexes
// with the matching stemmer so pt-BR queries tokenize correctly.
const search = createFromSource(source, {
  localeMap: {
    "en-US": "english",
    "pt-BR": "portuguese",
  },
});

export async function GET(request: Request) {
  await captureServerEvent("search_requested", request, {
    query: new URL(request.url).searchParams.get("query"),
  });

  return search.GET(request);
}
