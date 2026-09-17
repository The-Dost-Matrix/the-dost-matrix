import type { DocumentSourceType } from "./document";

/**
 * Bepaalt om wat voor soort document het gaat.
 *
 * Deze afleiding stond tot stap 25 in de uploadroute, en de Knowledge-pagina
 * had er een eigen, net iets andere versie van (een geneste reeks vragen die
 * alleen een MIME-type opleverde). Twee plaatsen die hetzelfde moeten
 * concluderen maar het los van elkaar doen, is een verschil dat vroeg of laat
 * ontstaat. Sinds de browser het bestand zelf uitleest móéten beide kanten
 * hetzelfde oordeel vellen: de ene kiest de parser, de andere beslist wat er
 * opgeslagen wordt.
 *
 * De bestandsnaam gaat vóór het MIME-type. Windows en de browser zijn het
 * over dat laatste geregeld oneens — een .md-bestand komt binnen als
 * `text/plain`, soms als lege tekenreeks, en een .xlsx dat uit een
 * e-mailprogramma komt nog weleens als `application/octet-stream`. De
 * extensie is wat de eigenaar zelf ziet en bedoelt.
 */
export function determineSourceType(
  fileName: string,
  mimeType: string,
): DocumentSourceType | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const normalizedMimeType = mimeType.trim().toLowerCase();

  if (
    extension === "md" ||
    extension === "markdown" ||
    extension === "txt" ||
    normalizedMimeType === "text/markdown" ||
    normalizedMimeType === "text/plain"
  ) {
    return "markdown";
  }

  if (extension === "pdf" || normalizedMimeType === "application/pdf") {
    return "pdf";
  }

  if (
    extension === "docx" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (
    extension === "xlsx" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }

  if (
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    normalizedMimeType === "image/jpeg" ||
    normalizedMimeType === "image/png"
  ) {
    return "image";
  }

  return null;
}

const MIME_TYPES_BY_SOURCE_TYPE: Record<DocumentSourceType, string> = {
  markdown: "text/markdown",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  image: "image/png",
};

/**
 * Vult een ontbrekend of nietszeggend MIME-type aan. De browser laat dat veld
 * geregeld leeg, en de uploadroute weigert een bestand zonder.
 */
export function resolveMimeType(fileName: string, reportedMimeType: string): string {
  const reported = reportedMimeType.trim().toLowerCase();

  if (reported && reported !== "application/octet-stream") return reported;

  const sourceType = determineSourceType(fileName, "");

  if (!sourceType) return reported || "application/octet-stream";

  if (sourceType === "image") {
    return fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  }

  return MIME_TYPES_BY_SOURCE_TYPE[sourceType];
}

/**
 * Van welke soorten wordt de inhoud werkelijk gelezen. Afbeeldingen staan er
 * bewust niet bij: daar hoort tekstherkenning bij, en die is er niet.
 */
export function isReadableSourceType(sourceType: DocumentSourceType): boolean {
  return sourceType !== "image";
}
