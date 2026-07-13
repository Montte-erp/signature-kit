import { fumapressPlugin } from "@fumapress/tegami/tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { tegami } from "tegami";

const paper = tegami({
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

await runCli(paper);
