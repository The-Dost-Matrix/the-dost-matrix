#!/usr/bin/env node
/**
 * Controleert of elke lokale import/export-specifier (via "@/..." of een
 * relatief pad zoals "./foo" of "../bar") daadwerkelijk naar een bestaand
 * bestand wijst. Externe pakketten (node_modules) worden overgeslagen —
 * die worden al door `npm ci` en TypeScript zelf gecontroleerd.
 *
 * Dit is de vaste, in de repository opgenomen versie van een controle die
 * eerder tijdens sessies handmatig (los, buiten de repository) werd
 * uitgevoerd om pull requests te beoordelen vóór het mergen — onder andere
 * de bug in pull request #14 waarbij topbar.tsx de niet-bestaande exports
 * "ActiveAgents"/"SystemMonitorStatus" importeerde in plaats van de
 * daadwerkelijke exports "ActiveAgentsPanel"/"SystemMonitorPanel". Door dit
 * script nu via .github/workflows/ci.yml bij elke pull request automatisch
 * te laten draaien, is zo'n fout al zichtbaar vóór een merge-beslissing, in
 * plaats van pas bij handmatige review achteraf.
 *
 * Bewust een losstaand script zonder afhankelijkheden (geen extra npm-
 * package) — het gebruikt alleen de ingebouwde Node.js-modules, dezelfde
 * insteek als github-client.ts voor de GitHub-API.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function collectSourceFiles(dir) {
  const results = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Zoekt naar een bestaand bestand voor een importspecifier, op dezelfde
 * manier als Next.js/TypeScript dat zelf zou doen: exact pad, met .ts/.tsx-
 * extensie, of als index-bestand van een map.
 */
function resolveSpecifier(baseDir, spec) {
  let candidate;

  if (spec.startsWith("@/")) {
    candidate = path.join(SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    candidate = path.normalize(path.join(baseDir, spec));
  } else {
    // Extern pakket (node_modules) — hier niet te controleren, en dat is
    // ook niet nodig: `npm ci` faalt al hard op een ontbrekend pakket.
    return { status: "external" };
  }

  const attempts = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
  ];

  for (const attempt of attempts) {
    if (existsSync(attempt) && statSync(attempt).isFile()) {
      return { status: "ok", target: attempt };
    }
  }

  return { status: "missing", target: candidate };
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

function main() {
  if (!existsSync(SRC)) {
    console.error(`Kan de "src"-map niet vinden op ${SRC}.`);
    process.exit(1);
  }

  const files = collectSourceFiles(SRC);
  const issues = [];
  let checked = 0;

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const baseDir = path.dirname(file);

    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      checked += 1;

      const result = resolveSpecifier(baseDir, spec);
      if (result.status === "missing") {
        issues.push({ file, spec, target: result.target });
      }
    }
  }

  console.log(`Checked ${checked} import specifiers across ${files.length} files.`);
  console.log(`Missing: ${issues.length}`);

  if (issues.length > 0) {
    console.log("");
    for (const issue of issues) {
      console.log(
        `  - ${path.relative(ROOT, issue.file)}: "${issue.spec}" -> geen bestand gevonden op ${path.relative(ROOT, issue.target)}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main();
