import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 80_000;
const MAX_TOTAL_BYTES = 160_000;

const BLOCKED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
]);

const BLOCKED_NAME_PARTS = [
  "adminsdk",
  "credential",
  "firebase-admin",
  "private-key",
  "private_key",
  "secret",
  "service-account",
  "service_account",
];

export type WorkspaceReadResult =
  | {
      relativePath: string;
      size: number;
      modifiedAt: string;
      content: string;
    }
  | { relativePath: string; error: string };

function normalizeRelativePath(input: string) {
  return input.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isBlockedWorkspacePath(relativePath: string) {
  const parts = relativePath.toLowerCase().split("/");
  const filename = parts.at(-1) ?? "";
  const extension = path.extname(filename);

  return (
    parts.some((part) => BLOCKED_DIRECTORIES.has(part)) ||
    filename === ".env" ||
    filename.startsWith(".env.") ||
    filename === "id_rsa" ||
    filename === "id_ed25519" ||
    BLOCKED_EXTENSIONS.has(extension) ||
    BLOCKED_NAME_PARTS.some((part) => filename.includes(part))
  );
}

function resolveInsideRoot(rootDirectory: string, relativePath: string) {
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(root, relativePath);
  const relation = path.relative(root, resolved);

  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("Pad valt buiten de projectroot of verwijst niet naar een bestand.");
  }

  return resolved;
}

export function parseWorkspaceReadRequest(content: string): string[] | null {
  const match = content.match(
    /<workspace-read>\s*([\s\S]*?)\s*<\/workspace-read>/i,
  );
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return null;

    const paths = parsed.paths
      .filter((item): item is string => typeof item === "string")
      .map(normalizeRelativePath)
      .filter(Boolean);

    return [...new Set(paths)].slice(0, MAX_FILES);
  } catch {
    return null;
  }
}

export async function readWorkspaceFiles(
  requestedPaths: string[],
  rootDirectory = process.cwd(),
): Promise<WorkspaceReadResult[]> {
  let totalBytes = 0;
  const results: WorkspaceReadResult[] = [];

  for (const relativePath of [...new Set(requestedPaths.map(normalizeRelativePath))].slice(
    0,
    MAX_FILES,
  )) {
        try {
          if (isBlockedWorkspacePath(relativePath)) {
            throw new Error("Toegang tot dit bestand is geblokkeerd.");
          }

          const absolutePath = resolveInsideRoot(rootDirectory, relativePath);
          const details = await stat(absolutePath);
          if (!details.isFile()) throw new Error("Het pad is geen bestand.");
          if (details.size > MAX_FILE_BYTES) {
            throw new Error("Bestand is te groot om veilig te lezen.");
          }
          if (totalBytes + details.size > MAX_TOTAL_BYTES) {
            throw new Error("Totale leeslimiet voor deze aanvraag is bereikt.");
          }

          const buffer = await readFile(absolutePath);
          if (buffer.includes(0)) throw new Error("Binaire bestanden worden niet gelezen.");
          totalBytes += details.size;

          results.push({
            relativePath,
            size: details.size,
            modifiedAt: details.mtime.toISOString(),
            content: buffer.toString("utf8"),
          });
        } catch (error) {
          results.push({
            relativePath,
            error: error instanceof Error ? error.message : "Bestand kon niet worden gelezen.",
          });
        }
  }

  return results;
}

export function formatWorkspaceReadResults(results: WorkspaceReadResult[]) {
  return results
    .map((result) => {
      if ("error" in result) {
        return `<workspace-file path=${JSON.stringify(result.relativePath)} error=${JSON.stringify(result.error)} />`;
      }

      return [
        `<workspace-file path=${JSON.stringify(result.relativePath)} size="${result.size}" modified-at=${JSON.stringify(result.modifiedAt)}>`,
        result.content,
        "</workspace-file>",
      ].join("\n");
    })
    .join("\n\n");
}
