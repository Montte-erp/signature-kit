import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const targets = [
  {
    path: ".source/source.config.mjs",
    generatedComments: ["// source.config.ts\n"],
  },
  {
    path: "next-env.d.ts",
    generatedComments: [
      "\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n",
    ],
  },
];

await Promise.all(
  targets.map(async (target) => {
    if (!existsSync(target.path)) return;
    const original = await readFile(target.path, "utf8");
    const cleaned = target.generatedComments.reduce(
      (content, generatedComment) => content.replaceAll(generatedComment, ""),
      original,
    );
    if (cleaned !== original) await writeFile(target.path, cleaned);
  }),
);
