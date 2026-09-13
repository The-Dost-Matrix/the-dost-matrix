"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  statusIcon,
  statusLabel,
  statusModifier,
  summarizeReportLevel,
  useSystemStatus,
} from "@/domains/system/system-status-service";
import {
  isActivePath,
  mainNavigation,
  plannedNavigation,
} from "@/domains/navigation/matrix-navigation";

/**
 * Navigatie en statusblok van het Command Center.
 *
 * Drie bewuste wijzigingen ten opzichte van de eerste versie:
 *
 * 1. Het statusblok onderaan toonde vaste teksten ("All systems operational",
 *    "KNOWLEDGE CORE ONLINE", "AI CONNECTION READY") die niets controleerden.
 *    Het komt nu uit /api/system/status, met per onderdeel het echte niveau.
 * 2. De navigatie bevatte items die nergens heen gingen en ook niet op de
 *    roadmap staan (Code Studio, Database, API Hub, System Logs). Die zijn
 *    verwijderd. Wat als "BINNENKORT" blijft staan, hoort bij een concrete
 *    roadmapstap; het stapnummer staat erbij zodat zichtbaar is dat het geen
 *    loze belofte is.
 * 3. mainNavigation/plannedNavigation/isActivePath komen sinds de mobiele
 *    layout niet meer lokaal uit dit bestand, maar uit
 *    matrix-navigation.ts — dezelfde lijst wordt nu ook gebruikt door
 *    topbar-navigation-menu.tsx (het uitklapbare navigatiepaneel dat op
 *    smalle schermen de rol van deze zijbalk overneemt, zie globals.css
 *    voor de breakpoint).
 */
export function Sidebar() {
  const pathname = usePathname();
  const systemStatus = useSystemStatus();
  const summaryLevel = summarizeReportLevel(systemStatus);

  return (
    <aside className="matrix-sidebar">
      {/*
        Het echte logo, aangeleverd door de eigenaar. Hier stond eerder een
        ruitje ◇ met daarnaast de teksten "THE DOST MATRIX" en "AI OPERATING
        SYSTEM"; die staan allebei al in de afbeelding zelf, dus ze zijn
        weggehaald in plaats van dubbel getoond.

        Breedte en hoogte zijn de werkelijke afmetingen van het bestand
        (432×290). Next.js gebruikt die verhouding om ruimte te reserveren
        vóórdat de afbeelding geladen is, zodat de navigatie eronder niet
        verspringt; de zichtbare grootte wordt in globals.css bepaald
        (.matrix-brand-logo).
      */}
      <div className="matrix-brand">
        <Image
          alt="The Dost Matrix"
          className="matrix-brand-logo"
          height={290}
          priority
          src="/logo-dost-matrix.png"
          width={432}
        />
      </div>

      <nav className="matrix-navigation">
        <p className="matrix-navigation-title">WERKRUIMTE</p>

        <div className="matrix-navigation-list">
          {mainNavigation.map((item) => (
            <Link
              key={item.label}
              className={`matrix-navigation-item ${
                isActivePath(pathname, item.href) ? "matrix-navigation-item--active" : ""
              }`}
              href={item.href}
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

      <div className="matrix-sidebar-status">
        <div className="matrix-sidebar-status-header">
          <span
            aria-hidden="true"
            className={`matrix-status-glyph ${statusModifier(summaryLevel)}`}
          >
            {statusIcon(summaryLevel)}
          </span>

          <div>
            <strong>SYSTEEMSTATUS</strong>
            <span>
              {systemStatus.loading ? "wordt gecontroleerd…" : statusLabel(summaryLevel)}
            </span>
          </div>
        </div>

        {systemStatus.report?.components.map((component) => (
          <div className="matrix-sidebar-metric" key={component.id}>
            <span>{component.label}</span>
            <strong className={statusModifier(component.level)}>
              {statusLabel(component.level)}
            </strong>
          </div>
        ))}

        {systemStatus.error && (
          <p className="matrix-status-error">{systemStatus.error}</p>
        )}
      </div>
    </aside>
  );
}
