import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorkspaceLayerDiagnostics } from "../src/layers";

const temporaryRoots: string[] = [];

const createTempWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "signature-kit-layers-"));
  temporaryRoots.push(root);
  return root;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writePackage = async (
  root: string,
  directory: string,
  name: string,
  dependencies: Record<string, string>,
  references: readonly string[],
  source: string,
): Promise<void> => {
  const packageDirectory = join(root, directory);
  await mkdir(join(packageDirectory, "src"), { recursive: true });
  await writeJson(join(packageDirectory, "package.json"), {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies,
  });
  await writeJson(join(packageDirectory, "tsconfig.json"), {
    extends: "../../tooling/typescript/core.json",
    include: ["src/**/*.ts"],
    references: references.map((path) => ({ path })),
  });
  await writeFile(join(packageDirectory, "src/index.ts"), source);
};

afterEach(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
  temporaryRoots.length = 0;
});

describe("workspace layer checks", () => {
  it("accepts the current repository package graph", () => {
    expect(collectWorkspaceLayerDiagnostics()).toEqual([]);
  });

  it("rejects runtime dependencies from lower layers to higher layers", async () => {
    const root = await createTempWorkspace();
    await writePackage(
      root,
      "core/core",
      "@signature-kit/core",
      {},
      [],
      "export const core = true;\n",
    );
    await writePackage(
      root,
      "shared/asn1",
      "@signature-kit/asn1",
      { "@signature-kit/core": "workspace:*" },
      ["../../core/core"],
      "import { core } from '@signature-kit/core';\nexport const value = core;\n",
    );

    expect(collectWorkspaceLayerDiagnostics(root)).toContainEqual({
      path: "shared/asn1/package.json",
      message:
        "@signature-kit/asn1 is a shared package and cannot depend on @signature-kit/core (core).",
    });
  });

  it("requires package dependencies and tsconfig references to stay aligned", async () => {
    const root = await createTempWorkspace();
    await writePackage(
      root,
      "shared/asn1",
      "@signature-kit/asn1",
      {},
      [],
      "export const asn1 = true;\n",
    );
    await writePackage(
      root,
      "core/certificates",
      "@signature-kit/certificates",
      { "@signature-kit/asn1": "workspace:*" },
      [],
      "import { asn1 } from '@signature-kit/asn1';\nexport const value = asn1;\n",
    );

    expect(collectWorkspaceLayerDiagnostics(root)).toContainEqual({
      path: "core/certificates/tsconfig.json",
      message:
        "@signature-kit/certificates depends on @signature-kit/asn1 but does not reference its tsconfig project.",
    });
  });

  it("rejects relative imports into another workspace package", async () => {
    const root = await createTempWorkspace();
    await writePackage(
      root,
      "signers/a1",
      "@signature-kit/a1",
      {},
      [],
      "export const signer = true;\n",
    );
    await writePackage(
      root,
      "formats/pdf",
      "@signature-kit/pdf",
      {},
      [],
      "import { signer } from '../../../signers/a1/src/index';\nexport const value = signer;\n",
    );

    expect(collectWorkspaceLayerDiagnostics(root)).toContainEqual({
      path: "formats/pdf/src/index.ts",
      message:
        "@signature-kit/pdf reaches into @signature-kit/a1 through a relative import; import the package entry point instead.",
    });
  });
});
