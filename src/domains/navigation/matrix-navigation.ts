/**
 * Eén gedeelde bron voor de werkruimte-navigatie (Command Center, Mission
 * Engine, Knowledge, Second Brain) en de geplande, nog niet gebouwde items
 * (Dost Council).
 *
 * Stond eerder alleen lokaal in sidebar.tsx. Verplaatst hierheen toen de
 * mobiele topbar (zie topbar-navigation-menu.tsx) exact dezelfde lijst nodig
 * kreeg: op smalle schermen verdwijnt de linker zijbalk (die legt op een
 * telefoon meer dan de helft van het scherm vast, zie de toelichting bij
 * .matrix-sidebar in globals.css) en komt deze navigatie in plaats daarvan
 * als uitklapbaar paneel in de topbar te staan. Eén bron voorkomt dat de
 * twee lijsten uit elkaar gaan lopen als er ooit een navigatie-item bijkomt.
 */
export interface MatrixNavigationItem {
  label: string;
  href: string;
  icon: string;
}

export interface MatrixPlannedNavigationItem {
  label: string;
  icon: string;
  step: string;
}

export const mainNavigation: MatrixNavigationItem[] = [
  { label: "Command Center", href: "/dashboard", icon: "◉" },
  { label: "Mission Engine", href: "/dashboard/missions-v2", icon: "⚙" },
  { label: "Knowledge", href: "/dashboard/knowledge", icon: "◇" },
  // Sinds stap 20 een echte pagina. Stond hiervoor in plannedNavigation
  // hieronder; een item hoort in precies één van de twee lijsten te staan,
  // zie de test daarop in matrix-navigation.test.ts.
  { label: "Second Brain", href: "/dashboard/second-brain", icon: "◈" },
];

export const plannedNavigation: MatrixPlannedNavigationItem[] = [
  { label: "Dost Council", icon: "⬡", step: "stap 13" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname.startsWith(href);
}
