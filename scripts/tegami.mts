import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fumapressPlugin } from "@fumapress/tegami/tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { tegami } from "tegami";

type ReleaseStatus = "none" | "pending" | "success";

export const isVersionLockClear = (status: ReleaseStatus): boolean => status !== "pending";

export const hasPublishPlan = (status: ReleaseStatus): boolean => status === "pending";

export const createReleaseProject = (cwd = process.cwd()) =>
  tegami({
    cwd,
    changelogDir: ".tegami",
    npm: {
      client: "bun",
      onBreakPeerDep: "error",
      trustedPublish: {
        provider: "github",
        workflow: "release.yml",
      },
      updateLockFile: true,
    },
    plugins: [
      fumapressPlugin({
        dir: "apps/docs/content/changelog",
      }),
      github({
        repo: "Montte-erp/signature-kit",
        versionPr: {
          branch: "tegami/version-packages",
          base: "main",
        },
      }),
    ],
  });

export const runReleaseCli = async (
  project: ReturnType<typeof createReleaseProject>,
  argv: readonly string[],
): Promise<void> => {
  const command = argv[0];
  if (command === "version" || command === "publish") {
    const { status, reason } = await project.getPublishStatus();
    if (command === "version" && !isVersionLockClear(status)) {
      console.error(reason ?? "A publish lock is already pending.");
      process.exitCode = 1;
      return;
    }
    if (command === "publish" && !hasPublishPlan(status)) {
      console.error("No pending publish plan found.");
      process.exitCode = 1;
      return;
    }
  }
  await createCli(project).parseAsync([...argv]);
};

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  await runReleaseCli(createReleaseProject(), process.argv.slice(2));
}
