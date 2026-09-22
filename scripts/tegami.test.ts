import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { Effect, Schema } from "effect";
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
    const workflow = await Effect.runPromise(
      Schema.decodeUnknownEffect(
        Schema.Struct({
          permissions: Schema.Struct({
            contents: Schema.Literal("write"),
            "id-token": Schema.Literal("write"),
          }),
          jobs: Schema.Struct({
            validate: Schema.Struct({ uses: Schema.Literal("./.github/workflows/checks.yml") }),
            release: Schema.Struct({
              needs: Schema.Literal("validate"),
              steps: Schema.Array(Schema.Struct({ run: Schema.optional(Schema.String) })),
            }),
          }),
        }),
      )(parse(await readFile(".github/workflows/release.yml", "utf8"))),
    );
    const commands = workflow.jobs.release.steps.flatMap((step) =>
      step.run === undefined ? [] : [step.run],
    );
    const gates = [
      "bun run build",
      "bun run release check-publish",
      "bun run release publish --dry-run",
      "bun run release publish",
    ];
    const positions = gates.map((command) => commands.indexOf(command));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(commands).not.toContain("bun run release version");
  });

  it("classifies lock statuses without treating absence as publishable", () => {
    expect(isVersionLockClear("none")).toBe(true);
    expect(isVersionLockClear("pending")).toBe(false);
    expect(hasPublishPlan("none")).toBe(false);
    expect(hasPublishPlan("pending")).toBe(true);
  });
});
