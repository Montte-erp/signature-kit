import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanScriptPath = join(docsRoot, "scripts/clean-generated-comments.ts");

const sourceGeneratedComment = "// source.config.ts\n";
const nextGeneratedComment =
  "\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n";

const createTempDocsRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "signature-kit-docs-clean-"));
  temporaryRoots.push(root);
  await mkdir(join(root, ".source"), { recursive: true });
  return root;
};

const runCleaner = (root: string): Promise<unknown> =>
  execFileAsync("bun", [cleanScriptPath], { cwd: root });

afterEach(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
  temporaryRoots.length = 0;
});

describe("generated comment cleaner", () => {
  it("skips next-env.d.ts when Next has not generated it yet", async () => {
    const root = await createTempDocsRoot();
    const sourceConfigPath = join(root, ".source/source.config.mjs");
    await writeFile(sourceConfigPath, `${sourceGeneratedComment}export default {};\n`);

    await runCleaner(root);

    expect(await readFile(sourceConfigPath, "utf8")).toBe("export default {};\n");
    expect(await readdir(root)).not.toContain("next-env.d.ts");
  });

  it("removes generated comments from every generated target that exists", async () => {
    const root = await createTempDocsRoot();
    const sourceConfigPath = join(root, ".source/source.config.mjs");
    const nextEnvPath = join(root, "next-env.d.ts");
    const nextEnvReferences =
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n';
    await writeFile(sourceConfigPath, `${sourceGeneratedComment}export const source = true;\n`);
    await writeFile(nextEnvPath, `${nextEnvReferences}${nextGeneratedComment}`);

    await runCleaner(root);

    expect(await readFile(sourceConfigPath, "utf8")).toBe("export const source = true;\n");
    expect(await readFile(nextEnvPath, "utf8")).toBe(nextEnvReferences);
  });
});
