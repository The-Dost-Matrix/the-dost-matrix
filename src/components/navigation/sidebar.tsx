"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  statusIcon,
  statusLabel,
  statusModifier,
  summarizeReportLevel,
  useSystemStatus,
} from "@/domains/system/system-status-service";

/**
 * Navigatie en statusblok van het Command Center.
 *
 * Twee bewuste wijzigingen ten opzichte van de eerste versie:
 *
 * 1. Het statusblok onderaan toonde vaste teksten ("All systems operational",
 *    "KNOWLEDGE CORE ONLINE", "AI CONNECTION READY") die niets controleerden.
 *    Het komt nu uit /api/system/status, met per onderdeel het echte niveau.
 * 2. De navigatie bevatte items die nergens heen gingen en ook niet op de
 *    roadmap staan (Code Studio, Database, API Hub, System Logs). Die zijn
 *    verwijderd. Wat als "BINNENKORT" blijft staan, hoort bij een concrete
 *    roadmapstap; het stapnummer staat erbij zodat zichtbaar is dat het geen
 *    loze belofte is.
 */
const mainNavigation = [
  { label: "Command Center", href: "/dashboard", icon: "◉" },
  { label: "Mission Engine", href: "/dashboard/missions-v2", icon: "⚙" },
  { label: "Knowledge", href: "/dashboard/knowledge", icon: "◇" },
];

const plannedNavigation = [
  { label: "Dost Council", icon: "⬡", step: "stap 13" },
  { label: "Second Brain", icon: "◈", step: "stap 18" },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const systemStatus = useSystemStatus();
  const summaryLevel = summarizeReportLevel(systemStatus);

  return (
    <aside className="matrix-sidebar">
      <div className="matrix-brand">
        <div className="matrix-brand-mark">◇</div>

        <div>
          <strong>THE DOST MATRIX</strong>
          <span>AI OPERATING SYSTEM</span>
        </div>
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
