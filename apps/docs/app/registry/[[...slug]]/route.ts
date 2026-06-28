import { NextResponse, type NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_FILES: ReadonlyArray<readonly [string, string]> = [
  ["a1-browser-signing", "registry/a1-browser-signing.tsx"],
  ["pdf-signature-line", "registry/pdf-signature-line.tsx"],
  ["pdf-signature-field", "registry/pdf-signature-field.tsx"],
  ["pdf-witness-lines", "registry/pdf-witness-lines.tsx"],
  ["pdf-initials-box", "registry/pdf-initials-box.tsx"],
  ["pdf-certificate-stamp", "registry/pdf-certificate-stamp.tsx"],
  ["pdf-party-signature-block", "registry/pdf-party-signature-block.tsx"],
  ["pdf-signature-grid", "registry/pdf-signature-grid.tsx"],
  ["pdf-approval-clause", "registry/pdf-approval-clause.tsx"],
  ["pdf-page-initials-footer", "registry/pdf-page-initials-footer.tsx"],
];
const DOCS_ROOT = existsSync(join(process.cwd(), "components.json"))
  ? process.cwd()
  : join(process.cwd(), "apps/docs");

const COMPONENTS_FILE_PATH = join(DOCS_ROOT, "components.json");

const isNamedRegistryEntry =
  (name: string) =>
  (entry: unknown): entry is { readonly name: string } =>
    typeof entry === "object" && entry !== null && Reflect.get(entry, "name") === name;

const readRegistry = (): unknown | undefined =>
  existsSync(COMPONENTS_FILE_PATH)
    ? JSON.parse(readFileSync(COMPONENTS_FILE_PATH, "utf8"))
    : undefined;

const findRegistryItem = (
  registry: unknown,
  name: string,
): { readonly name: string } | undefined => {
  const items =
    typeof registry === "object" && registry !== null ? Reflect.get(registry, "items") : undefined;

  return Array.isArray(items) ? items.find(isNamedRegistryEntry(name)) : undefined;
};

const resolveRegistryItemName = (path: string): string | undefined => {
  for (const [name] of REGISTRY_FILES) {
    if (path === name || path === `${name}.json`) {
      return name;
    }
  }

  return undefined;
};

const resolveRegistrySourcePath = (path: string): string | undefined => {
  for (const [, registryPath] of REGISTRY_FILES) {
    const fileName = registryPath.split("/").at(-1);
    if (path === registryPath || path === fileName) {
      return registryPath;
    }
  }

  return undefined;
};

const readRegistrySource = (registryPath: string): string | undefined => {
  const sourceFilePath = join(DOCS_ROOT, registryPath);
  if (!existsSync(sourceFilePath)) {
    return undefined;
  }
  return readFileSync(sourceFilePath, "utf8");
};

const notFound = (): Response => new Response("Registry entry not found", { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<Response> {
  const registry = readRegistry();
  const { slug } = await params;
  const segments = slug ?? [];
  const path = segments.join("/");

  if (registry === undefined) {
    return notFound();
  }

  if (path === "") {
    return NextResponse.json(registry);
  }

  const itemName = resolveRegistryItemName(path);
  if (itemName !== undefined) {
    const item = findRegistryItem(registry, itemName);
    return item === undefined ? notFound() : NextResponse.json(item);
  }

  const registryPath = resolveRegistrySourcePath(path);

  if (registryPath === undefined) {
    return notFound();
  }

  const contents = readRegistrySource(registryPath);
  if (contents === undefined) {
    return notFound();
  }

  return new Response(contents, {
    headers: {
      "content-type": "text/plain;charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
