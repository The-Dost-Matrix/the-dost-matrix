#!/usr/bin/env node

/**
 * Zet de pdf.js-werker klaar in `public/`, na elke `npm install`.
 *
 * WAAROM DIT BESTAAT
 *
 * pdf.js draait zijn ontleedwerk in een aparte browserwerker. Die moet als
 * bestand te benaderen zijn, en er zijn twee manieren om daaraan te komen:
 * de bundelaar het pad laten oplossen tijdens de bouw, of het bestand naast
 * de site zetten. De eerste manier is de gangbare, maar hij faalt hard —
 * pdf.js heeft de bestandsnaam van de werker tussen grote versies al eens
 * verplaatst, en dan breekt niet de upload maar de hele bouw op Vercel.
 *
 * Deze kopie komt altijd uit de versie die werkelijk in node_modules staat,
 * dus werker en bibliotheek kunnen niet uit de pas lopen. Dat is geen detail:
 * pdf.js weigert te draaien als die twee van verschillende versies zijn.
 *
 * Dit script stopt nooit met een foutcode. Is pdfjs-dist er niet, of is de
 * werker onder een onbekende naam verhuisd, dan zegt het dat en gaat de
 * installatie gewoon door — de PDF-tak valt dan terug op "alleen vastgelegd",
 * precies zoals het gedrag vóór stap 25 was. Een ontbrekend hulpbestand mag
 * nooit een bouw tegenhouden.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(projectRoot, "public");
const destination = join(publicDirectory, "pdf.worker.min.mjs");

/**
 * In volgorde van voorkeur. De eerste twee zijn de namen die pdf.js 4 en 5
 * gebruiken; de laatste twee vangen een oudere installatie op.
 */
const candidates = [
  "pdfjs-dist/build/pdf.worker.min.mjs",
  "pdfjs-dist/build/pdf.worker.mjs",
  "pdfjs-dist/build/pdf.worker.min.js",
  "pdfjs-dist/build/pdf.worker.js",
];

function findWorker() {
  for (const candidate of candidates) {
    const path = join(projectRoot, "node_modules", candidate);

    if (existsSync(path)) return path;
  }

  return null;
}

const source = findWorker();

if (!source) {
  console.warn(
    "[copy-pdf-worker] De pdf.js-werker is niet gevonden in node_modules. " +
      "PDF-bestanden worden dan alleen vastgelegd en niet gelezen.",
  );
} else {
  mkdirSync(publicDirectory, { recursive: true });
  copyFileSync(source, destination);
  console.log(`[copy-pdf-worker] Werker gekopieerd vanuit ${source}`);
}
