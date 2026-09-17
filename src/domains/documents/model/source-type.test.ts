import { describe, expect, it } from "vitest";

import {
  determineSourceType,
  isReadableSourceType,
  resolveMimeType,
} from "./source-type";

describe("determineSourceType", () => {
  it("herkent de soorten aan hun extensie", () => {
    expect(determineSourceType("notities.md", "")).toBe("markdown");
    expect(determineSourceType("rapport.pdf", "")).toBe("pdf");
    expect(determineSourceType("brief.docx", "")).toBe("docx");
    expect(determineSourceType("begroting.xlsx", "")).toBe("xlsx");
    expect(determineSourceType("foto.PNG", "")).toBe("image");
  });

  it("laat de extensie voorgaan op een MIME-type dat ernaast zit", () => {
    // Een .xlsx uit een e-mailprogramma komt regelmatig binnen als
    // octet-stream. Afgaan op het MIME-type zou dat bestand weigeren.
    expect(
      determineSourceType("begroting.xlsx", "application/octet-stream"),
    ).toBe("xlsx");
  });

  it("valt terug op het MIME-type wanneer de naam niets prijsgeeft", () => {
    expect(determineSourceType("bijlage", "application/pdf")).toBe("pdf");
  });

  it("geeft null voor een soort waar geen plaats voor is", () => {
    expect(determineSourceType("archief.zip", "application/zip")).toBeNull();
  });
});

describe("resolveMimeType", () => {
  it("vult een ontbrekend type aan op basis van de bestandsnaam", () => {
    expect(resolveMimeType("notities.md", "")).toBe("text/markdown");
    expect(resolveMimeType("rapport.pdf", "")).toBe("application/pdf");
    expect(resolveMimeType("foto.jpg", "")).toBe("image/jpeg");
  });

  it("vervangt het nietszeggende octet-stream", () => {
    expect(resolveMimeType("brief.docx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("laat een bruikbaar type van de browser staan", () => {
    expect(resolveMimeType("foto.png", "image/png")).toBe("image/png");
  });
});

describe("isReadableSourceType", () => {
  it("sluit afbeeldingen uit en de rest niet", () => {
    // De harde regel uit de roadmap: de UI belooft pas dat een soort gelezen
    // wordt zodra dat werkelijk zo is. Voor afbeeldingen is er geen
    // tekstherkenning, dus die belofte wordt niet gedaan.
    expect(isReadableSourceType("image")).toBe(false);
    expect(isReadableSourceType("pdf")).toBe(true);
    expect(isReadableSourceType("markdown")).toBe(true);
  });
});
