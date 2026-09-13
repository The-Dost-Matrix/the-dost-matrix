"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  isActivePath,
  mainNavigation,
  plannedNavigation,
} from "@/domains/navigation/matrix-navigation";

/**
 * Mobiele vervanging van de linker zijbalk-navigatie (sidebar.tsx).
 *
 * Aanleiding: .matrix-sidebar had een vaste breedte van 250px, ongeacht
 * schermgrootte — op een telefoon (~390-430px breed) at dat ruim de helft
 * van het scherm op, met de rest van de app in een onbruikbaar smalle kolom
 * geperst (elk woord viel character-voor-character op een eigen regel). De
 * zijbalk verdwijnt daarom volledig onder de 900px-breakpoint (zie
 * .matrix-sidebar in globals.css) en deze component neemt de navigatie-rol
 * over als uitklapbaar paneel in de topbar — hetzelfde patroon als de
 * bestaande "Recent Activity"/"Systeemstatus"-panelen in topbar.tsx.
 *
 * Gebruikt dezelfde mainNavigation/plannedNavigation/isActivePath uit
 * matrix-navigation.ts als de zijbalk, zodat de twee nooit uit elkaar lopen.
 *
 * `onNavigate` sluit het uitklappaneel na een klik op een navigatielink —
 * zonder dat blijft het paneel open staan over de nieuwe pagina heen, wat op
 * een telefoon (waar dit paneel bijna het hele scherm beslaat) verwarrend is.
 */
export function TopbarNavigationMenu({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="matrix-navigation matrix-navigation--topbar">
      <p className="matrix-navigation-title">WERKRUIMTE</p>

      <div className="matrix-navigation-list">
        {mainNavigation.map((item) => (
          <Link
            key={item.label}
            className={`matrix-navigation-item ${
              isActivePath(pathname, item.href) ? "matrix-navigation-item--active" : ""
            }`}
            href={item.href}
            onClick={onNavigate}
          >
            <span className="matrix-navigation-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>

      <p className="matrix-navigation-title matrix-navigation-title--spaced">GEPLAND</p>

      <div className="matrix-navigation-list">
        {plannedNavigation.map((item) => (
          <button
            key={item.label}
            className="matrix-navigation-item matrix-navigation-item--disabled"
            disabled
            type="button"
          >
            <span className="matrix-navigation-icon">{item.icon}</span>
            <span>{item.label}</span>
            <small>{item.step}</small>
          </button>
        ))}
      </div>
    </nav>
  );
}
