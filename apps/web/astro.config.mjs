import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: "https://trustsign.dev",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "~": resolve(root, "./src"),
        "@": resolve(root, "./src"),
      },
    },
  },
});
