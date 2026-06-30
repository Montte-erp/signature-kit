import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";
import { captureServerEvent } from "@/lib/posthog/server";

export const revalidate = false;

export async function GET(request: Request) {
  await captureServerEvent("llms_full_txt_requested", request);

  const pageSections = await Promise.all(
    source.getPages().map(async (page) => {
      const header = [`# ${page.data.title}`, "", `URL: ${page.url}`];

      if (page.data.description !== undefined) {
        header.push("", `> ${page.data.description}`);
      }

      const processed = await page.data.getText("processed");

      return [...header, "", processed].join("\n").trim();
    }),
  );

  return new Response([llms(source).index(), ...pageSections].join("\n\n---\n\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
