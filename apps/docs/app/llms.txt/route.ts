import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";
import { captureServerEvent } from "@/lib/posthog/server";

export const revalidate = false;

export async function GET(request: Request) {
  await captureServerEvent("llms_txt_requested", request);

  return new Response(llms(source).index(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
