/**
 * Hoe een soort kennisitem er op het scherm uitziet: een pictogram en een
 * Nederlandse naam.
 *
 * Stond tot 18 september 2026 als lokale constante in de Knowledge-pagina.
 * Verplaatst toen de Second Brain-pagina (stap 20) dezelfde lijst nodig kreeg.
 * Twee kopieën van deze tabel zouden onopvallend uiteenlopen — dan heet
 * `lesson` op de ene pagina "Les" en op de andere iets anders, en gaat een
 * gebruiker denken dat het om verschillende dingen gaat.
 *
 * De sleutels zijn de waarden van KnowledgeType, plus "legacydocument" voor
 * items uit de tijd dat een heel document als één kennisitem werd bewaard.
 */
export const knowledgeTypePresentation: Record<string, { icon: string; label: string }> = {
  vision: { icon: "🔭", label: "Visie" },
  goal: { icon: "🎯", label: "Doel" },
  decision: { icon: "⚖️", label: "Beslissing" },
  architecture: { icon: "🏗️", label: "Architectuur" },
  project: { icon: "📁", label: "Project" },
  process: { icon: "⚙️", label: "Proces" },
  preference: { icon: "⭐", label: "Voorkeur" },
  lesson: { icon: "💡", label: "Les" },
  task: { icon: "✅", label: "Taak" },
  risk: { icon: "⚠️", label: "Risico" },
  open_question: { icon: "❓", label: "Open vraag" },
  person: { icon: "👤", label: "Persoon" },
  company: { icon: "🏢", label: "Bedrijf" },
  fact: { icon: "📌", label: "Feit" },
  legacydocument: { icon: "📄", label: "Document" },
};

/** De naam van een soort, met terugval op de ruwe waarde. */
export function knowledgeTypeLabel(type: string | undefined): string {
  const key = type ?? "fact";

  return knowledgeTypePresentation[key]?.label ?? key;
}

/** Het pictogram van een soort, met het algemene "feit"-teken als terugval. */
export function knowledgeTypeIcon(type: string | undefined): string {
  return knowledgeTypePresentation[type ?? "fact"]?.icon ?? "📌";
}
