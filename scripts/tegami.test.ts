import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  createReleaseProject,
  hasPublishPlan,
  isVersionLockClear,
  runReleaseCli,
} from "./tegami.mts";

const temporaryRoots: string[] = [];
const originalCi = process.env.CI;
const originalFetch = globalThis.fetch;

const createTempWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "signature-kit-tegami-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "packages", "fixture"), { recursive: true });
  await mkdir(join(root, "apps", "docs", "content", "changelog"), {
    recursive: true,
  });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "fixture-root",
      private: true,
      workspaces: ["packages/*"],
    })}\n`,
  );
  await writeFile(
    join(root, "packages", "fixture", "package.json"),
    `${JSON.stringify({
      name: "@fixture/package",
      version: "1.0.0",
      publishConfig: { access: "public" },
    })}\n`,
  );
  return root;
};

const writeChangelog = async (root: string): Promise<void> => {
  await mkdir(join(root, ".tegami"), { recursive: true });
  await writeFile(
    join(root, ".tegami", "fixture.md"),
    '---\npackages:\n  "@fixture/package": patch\n---\n\n## Fixed release\n\nRelease fixture.\n',
  );
};
const resetProcessState = (): void => {
  process.exitCode = undefined;
  globalThis.fetch = originalFetch;
  if (originalCi === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCi;
  }
};

afterEach(async () => {
  resetProcessState();
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
  temporaryRoots.length = 0;
});

describe("Tegami release guards", () => {
  it("rejects publishing when no lock exists", async () => {
    const root = await createTempWorkspace();
    const project = createReleaseProject(root);

    await runReleaseCli(project, ["publish", "--dry-run"]);

    expect(process.exitCode).toBe(1);
  });

  it("rejects replacing a pending lock", async () => {
    const root = await createTempWorkspace();
    await writeChangelog(root);
    const project = createReleaseProject(root);
    await (await project.draft()).apply();
    globalThis.fetch = async () => new Response(null, { status: 404 });

    await runReleaseCli(project, ["version"]);

    expect(process.exitCode).toBe(1);
  });

  it("validates a generated plan before the publish command", async () => {
    const root = await createTempWorkspace();
    await writeChangelog(root);
    const project = createReleaseProject(root);
    await (await project.draft()).apply();
    globalThis.fetch = async () => new Response(null, { status: 404 });

    delete process.env.CI;
    await runReleaseCli(project, ["publish", "--dry-run"]);

    expect(process.exitCode).toBeUndefined();
    expect(hasPublishPlan((await project.getPublishStatus()).status)).toBe(true);
  });

  it("keeps the parseable workflow gates ordered before real publish", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");
    expect(parse(workflow)).toBeTypeOf("object");
    const commands = [
      "bun run release version",
      "bun run release check-publish",
      "bun run release publish --dry-run",
      "bun run release publish",
    ];
    const positions = commands.map((command) => workflow.indexOf(command));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("pull-requests: write");
  });

  it("classifies lock statuses without treating absence as publishable", () => {
    expect(isVersionLockClear("none")).toBe(true);
    expect(isVersionLockClear("pending")).toBe(false);
    expect(hasPublishPlan("none")).toBe(false);
    expect(hasPublishPlan("pending")).toBe(true);
  });
});
