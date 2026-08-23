import * as fs from "fs/promises";
import * as path from "path";

export const PROJECT_ROOT = path.resolve(process.cwd());

/**
 * Toegestane schrijfgebieden binnen projectroot.
 * Moeten expliciet worden gedefinieerd en geverifieerd.
 */
export const ALLOWED_WRITE_PATHS = [PROJECT_ROOT];

/**
 * Controleer of een pad binnen één van de toegestane schrijfgebieden valt.
 * Resolves pad en vergelijkt veilig, voorkomt directory-traversal.
 */
export function isWritePathAllowed(targetPath: string): boolean {
  const absPath = path.resolve(targetPath);
  return ALLOWED_WRITE_PATHS.some((allowedRoot) => {
    const relative = path.relative(allowedRoot, absPath);
    return (
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  });
}

/**
 * Veilig asynchroon schrijven naar bestand binnen toegestane gebieden.
 * Werpt fout bij poging buiten scope.
 */
export async function safeWriteFile(
  targetPath: string,
  content: string,
): Promise<void> {
  if (!isWritePathAllowed(targetPath)) {
    throw new Error(`Schrijfactie geweigerd: pad valt buiten de toegestane locaties: ${targetPath}`);
  }

  await fs.writeFile(targetPath, content, { encoding: "utf-8" });
}