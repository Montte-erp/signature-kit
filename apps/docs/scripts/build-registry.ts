import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type RegistryFile = {
  readonly path: string;
  readonly type: string;
  readonly target?: string;
};

type RegistryItem = {
  readonly name: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly registryDependencies?: ReadonlyArray<string>;
  readonly dependencies?: ReadonlyArray<string>;
  readonly files: ReadonlyArray<RegistryFile>;
  readonly docs?: string;
};

type RegistryCatalog = {
  readonly $schema: string;
  readonly name: string;
  readonly homepage: string;
  readonly items: ReadonlyArray<RegistryItem>;
};

const appRoot = new URL("../", import.meta.url);
const outputRoot = new URL("../public/r/", import.meta.url);

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: "signature-kit",
  homepage: "https://signaturekit.dev",
  items: [
    {
      name: "signature-certificate-form",
      type: "registry:component",
      title: "Signature Certificate Form",
      description: "Password confirmation form for browser A1 signing, with callback-owned persistence.",
      registryDependencies: ["button", "checkbox", "input", "label"],
      dependencies: ["@tanstack/react-form@0.11.0", "lucide-react"],
      files: [
        {
          path: "registry/default/signature-certificate-form/signature-certificate-form.tsx",
          type: "registry:component",
          target: "components/signature-kit/signature-certificate-form.tsx",
        },
      ],
    },
    {
      name: "certificate-upload-form",
      type: "registry:component",
      title: "Certificate Upload Form",
      description: "PFX/P12 upload form that parses an A1 certificate in the browser and returns profile metadata.",
      registryDependencies: ["badge", "button", "card", "input", "label"],
      dependencies: ["@signature-kit/react", "@signature-kit/a1", "@tanstack/react-form@0.11.0", "lucide-react"],
      files: [
        {
          path: "registry/default/certificate-upload-form/certificate-upload-form.tsx",
          type: "registry:component",
          target: "components/signature-kit/certificate-upload-form.tsx",
        },
      ],
    },
    {
      name: "signature-pdf-viewer",
      type: "registry:component",
      title: "Signature PDF Viewer",
      description: "react-pdf preview with text-anchor highlighting and manual click-to-place signature rectangles.",
      registryDependencies: ["badge", "button"],
      dependencies: ["@signature-kit/pdf", "effect@4.0.0-beta.86", "lucide-react", "react-pdf@10.4.1"],
      files: [
        {
          path: "registry/default/signature-pdf-viewer/signature-pdf-viewer.tsx",
          type: "registry:component",
          target: "components/signature-kit/signature-pdf-viewer.tsx",
        },
      ],
    },
    {
      name: "signature-dialog",
      type: "registry:block",
      title: "Signature Dialog",
      description: "Direct browser A1 signing dialog with saved-password retry handling, progress rows, and signed-PDF download preview.",
      registryDependencies: ["badge", "button", "checkbox", "dialog", "input", "label"],
      dependencies: [
        "@signature-kit/react",
        "@signature-kit/i18n",
        "@signature-kit/pdf",
        "@signature-kit/cms",
        "@signature-kit/signatures",
        "@tanstack/react-form@0.11.0",
        "lucide-react",
      ],
      files: [
        {
          path: "registry/default/signature-dialog/signature-dialog.tsx",
          type: "registry:component",
          target: "components/signature-kit/signature-dialog.tsx",
        },
      ],
    },
    {
      name: "signing-progress-list",
      type: "registry:component",
      title: "Signing Progress List",
      description: "Standalone per-document signing status list for pending, signing, signed, and failed rows.",
      registryDependencies: ["badge"],
      dependencies: ["lucide-react"],
      files: [
        {
          path: "registry/default/signing-progress-list/signing-progress-list.tsx",
          type: "registry:component",
          target: "components/signature-kit/signing-progress-list.tsx",
        },
      ],
    },
    {
      name: "pdf-signature-anchor",
      type: "registry:component",
      title: "PDF Signature Anchor",
      description: "Invisible @react-pdf/renderer Text marker for SignatureKit text-anchor placement.",
      dependencies: ["@react-pdf/renderer"],
      files: [
        {
          path: "registry/default/pdf-signature-anchor/pdf-signature-anchor.tsx",
          type: "registry:component",
          target: "components/signature-kit/pdf-signature-anchor.tsx",
        },
      ],
    },
  ],
} satisfies RegistryCatalog;

const writeJson = async (path: URL, value: unknown): Promise<void> => {
  await mkdir(new URL("./", path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const itemWithFileContent = async (item: RegistryItem): Promise<RegistryItem> => {
  const files = await Promise.all(
    item.files.map(async (file) => ({
      ...file,
      content: await readFile(new URL(file.path, appRoot), "utf8"),
    })),
  );
  return { ...item, files };
};

await mkdir(outputRoot, { recursive: true });
await writeJson(new URL("registry.json", outputRoot), registry);

for (const item of registry.items) {
  const outputPath = new URL(`${item.name}.json`, outputRoot);
  await mkdir(dirname(fileURLToPath(outputPath)), { recursive: true });
  await writeJson(outputPath, {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    ...(await itemWithFileContent(item)),
  });
}
