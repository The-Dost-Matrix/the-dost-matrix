import { describe, expect, it } from "vitest";

import { decodeXmlEntities, readAttribute, tidyExtractedText } from "./xml-text";

describe("decodeXmlEntities", () => {
  it("zet de vijf XML-entiteiten terug om", () => {
    expect(decodeXmlEntities("Onderzoek &amp; ontwerp")).toBe("Onderzoek & ontwerp");
    expect(decodeXmlEntities("&lt;haakje&gt;")).toBe("<haakje>");
    expect(decodeXmlEntities("&quot;aanhaling&quot;")).toBe('"aanhaling"');
    expect(decodeXmlEntities("&apos;t")).toBe("'t");
  });

  it("verwerkt numerieke verwijzingen, decimaal en hexadecimaal", () => {
    expect(decodeXmlEntities("caf&#233;")).toBe("café");
    expect(decodeXmlEntities("em&#x2014;dash")).toBe("em—dash");
  });

  it("laat iets wat op een entiteit lijkt maar het niet is met rust", () => {
    expect(decodeXmlEntities("100 &euro; per maand")).toBe("100 &euro; per maand");
    expect(decodeXmlEntities("A & B")).toBe("A & B");
  });
});

describe("readAttribute", () => {
  it("leest een attribuut en ontcijfert de waarde", () => {
    expect(readAttribute(' name="Kosten &amp; baten" sheetId="1"', "name")).toBe(
      "Kosten & baten",
    );
  });

  it("verwart een naamruimte-attribuut niet met het korte attribuut", () => {
    // Een cel heeft `r="A1"`, een blad heeft `r:id="rId1"`. Zoeken naar "r"
    // mag het tweede niet vinden, anders wijst elk werkblad naar bestand "A1".
    expect(readAttribute(' r:id="rId1"', "r")).toBeNull();
    expect(readAttribute(' r:id="rId1"', "r:id")).toBe("rId1");
  });

  it("geeft null wanneer het attribuut ontbreekt", () => {
    expect(readAttribute(' t="s"', "r")).toBeNull();
  });
});

describe("tidyExtractedText", () => {
  it("haalt overtollige lege regels en witruimte weg", () => {
    expect(tidyExtractedText("\n\nEen   \n\n\n\nTwee \t\n\n")).toBe("Een\n\nTwee");
  });

  it("maakt van Windows-regeleindes gewone regeleindes", () => {
    expect(tidyExtractedText("regel\r\nregel")).toBe("regel\nregel");
  });
});
