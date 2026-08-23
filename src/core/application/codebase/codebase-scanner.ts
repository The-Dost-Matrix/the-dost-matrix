import { promises as fs } from "node:fs";
import path from "node:path";

import { isBlockedWorkspacePath } from "@/core/application/codebase/workspace-reader";

export type CodebaseFile = {
  relativePath: string;
  extension: string;
  size: number;
};

export type CodebaseSnapshot = {
  root: string;
  generatedAt: string;
  directories: string[];
  files: CodebaseFile[];
  tree: string;
};

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules",
]);

const EXCLUDED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function shouldIgnoreDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

function shouldIgnoreFile(name: string): boolean {
  return EXCLUDED_FILES.has(name);
}

function createTree(
  directories: string[],
  files: CodebaseFile[],
): string {
  const paths = [
    ...directories.map((directory) => ({
      path: directory,
      type: "directory" as const,
    })),
    ...files.map((file) => ({
      path: file.relativePath,
      type: "file" as const,
    })),
  ].sort((first, second) =>
    first.path.localeCompare(second.path),
  );

  return paths
    .map((item) => {
      const depth = item.path.split("/").length - 1;
      const name = item.path.split("/").at(-1) ?? item.path;
      const prefix = "  ".repeat(depth);

      return item.type === "directory"
        ? `${prefix}📁 ${name}/`
        : `${prefix}📄 ${name}`;
    })
    .join("\n");
}

async function scanDirectory(
  absoluteDirectory: string,
  rootDirectory: string,
  directories: string[],
  files: CodebaseFile[],
): Promise<void> {
  const entries = await fs.readdir(absoluteDirectory, {
    withFileTypes: true,
  });

  entries.sort((first, second) =>
    first.name.localeCompare(second.name),
  );

  for (const entry of entries) {
    const absolutePath = path.join(
      absoluteDirectory,
      entry.name,
    );

    const relativePath = normalizePath(
      path.relative(rootDirectory, absolutePath),
    );

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        continue;
      }

      directories.push(relativePath);

      await scanDirectory(
        absolutePath,
        rootDirectory,
        directories,
        files,
      );

      continue;
    }

    if (
      !entry.isFile() ||
      shouldIgnoreFile(entry.name) ||
      isBlockedWorkspacePath(relativePath)
    ) {
      continue;
    }

    const stats = await fs.stat(absolutePath);

    files.push({
      relativePath,
      extension: path.extname(entry.name).toLowerCase(),
      size: stats.size,
    });
  }
}

export async function createCodebaseSnapshot(
  rootDirectory = process.cwd(),
): Promise<CodebaseSnapshot> {
  const directories: string[] = [];
  const files: CodebaseFile[] = [];

  await scanDirectory(
    rootDirectory,
    rootDirectory,
    directories,
    files,
  );

  return {
    root: normalizePath(rootDirectory),
    generatedAt: new Date().toISOString(),
    directories,
    files,
    tree: createTree(directories, files),
  };
}
