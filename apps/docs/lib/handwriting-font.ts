import { Caveat } from "next/font/google";

// Loaded as a non-client module so `Caveat()` runs in Next's build-time font
// transform. The injected family name (`caveat.style.fontFamily`) is what we
// pass to canvas `ctx.font` when rendering the handwriting marks.
export const caveat = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });
