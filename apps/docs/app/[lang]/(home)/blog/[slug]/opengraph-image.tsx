import { ImageResponse } from "next/og";

import { blogSource } from "@/lib/blog-source";

// Dynamic OG image per post, drawn with next/og in the shadcn "stone" dark
// palette (no shadcn OG component exists, so we theme it by hand). Colocated with
// the post route, so Next wires it as the og:image / twitter:image automatically.

export const alt = "SignatureKit blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return blogSource.generateParams().map((param) => ({
    lang: param.lang,
    slug: param.slug.join("/"),
  }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  const page = blogSource.getPage([slug], lang);
  const title = page?.data.title ?? "SignatureKit";
  const author = page?.data.author ?? "Montte";
  const date = page?.data.date ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px",
          color: "#fafafa",
          backgroundColor: "#191817",
          backgroundImage:
            "radial-gradient(900px 500px at 18% -10%, #262422, #191817 62%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "30px" }}>
          <div
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              border: "2px solid #fafafa",
              display: "flex",
            }}
          />
          <span style={{ fontWeight: 600 }}>SignatureKit</span>
          <span style={{ color: "#8a8784" }}>/ blog</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: "68px",
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-0.025em",
            maxWidth: "1010px",
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "26px",
            color: "#a8a39d",
            borderTop: "1px solid #34302c",
            paddingTop: "28px",
          }}
        >
          <span>{author}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{date}</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
