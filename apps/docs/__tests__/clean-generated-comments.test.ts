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
  it("skips source config when it has not been generated yet", async () => {
    const root = await createTempDocsRoot();

    await runCleaner(root);

    expect(await readdir(join(root, ".source"))).not.toContain("source.config.mjs");
  });

  it("removes generated comments from the generated source config", async () => {
    const root = await createTempDocsRoot();
    const sourceConfigPath = join(root, ".source/source.config.mjs");
    await writeFile(sourceConfigPath, `${sourceGeneratedComment}export const source = true;\n`);

    await runCleaner(root);

    expect(await readFile(sourceConfigPath, "utf8")).toBe("export const source = true;\n");
  });
});
