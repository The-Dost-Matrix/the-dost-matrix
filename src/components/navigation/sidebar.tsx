"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const mainNavigation = [
  {
    label: "Command Center",
    href: "/dashboard",
    icon: "◉",
  },

  {
    label: "Knowledge",
    href: "/dashboard/knowledge",
    icon: "◇",
  },
  {
    label: "Documents",
    href: "/dashboard/documents",
    icon: "▧",
    disabled: true,
  },
  {
    label: "Missions",
    href: "/dashboard/missions",
    icon: "◎",
    disabled: true,
  },
  {
    label: "Director",
    href: "/dashboard/director",
    icon: "⌘",
    disabled: true,
  },
  {
    label: "Agents",
    href: "/dashboard/agents",
    icon: "⬡",
    disabled: true,
  },
];

const developmentNavigation = [
  {
    label: "Code Studio",
    icon: "⌨",
  },
  {
    label: "Database",
    icon: "▤",
  },
  {
    label: "API Hub",
    icon: "⌁",
  },
  {
    label: "System Logs",
    icon: "≡",
  },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();

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
        <p className="matrix-navigation-title">MAIN INTERFACE</p>

        <div className="matrix-navigation-list">
          {mainNavigation.map((item) => {
            if (item.disabled) {
              return (
                <button
                  key={item.label}
                  className="matrix-navigation-item matrix-navigation-item--disabled"
                  disabled
                  type="button"
                >
                  <span className="matrix-navigation-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  <small>SOON</small>
                </button>
              );
            }

            return (
              <Link
                key={item.label}
                className={`matrix-navigation-item ${
                  isActivePath(pathname, item.href)
                    ? "matrix-navigation-item--active"
                    : ""
                }`}
                href={item.href}
              >
                <span className="matrix-navigation-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <p className="matrix-navigation-title matrix-navigation-title--spaced">
          DEVELOPMENT
        </p>

        <div className="matrix-navigation-list">
          {developmentNavigation.map((item) => (
            <button
              key={item.label}
              className="matrix-navigation-item matrix-navigation-item--disabled"
              disabled
              type="button"
            >
              <span className="matrix-navigation-icon">{item.icon}</span>
              <span>{item.label}</span>
              <small>SOON</small>
            </button>
          ))}
        </div>
      </nav>

      <div className="matrix-sidebar-status">
        <div className="matrix-sidebar-status-header">
          <span className="matrix-status-dot" />

          <div>
            <strong>MATRIX STATUS</strong>
            <span>All systems operational</span>
          </div>
        </div>

        <div className="matrix-sidebar-metric">
          <span>KNOWLEDGE CORE</span>
          <strong>ONLINE</strong>
        </div>

        <div className="matrix-sidebar-metric">
          <span>DOCUMENT PIPELINE</span>
          <strong>ACTIVE</strong>
        </div>

        <div className="matrix-sidebar-metric">
          <span>AI CONNECTION</span>
          <strong>READY</strong>
        </div>
      </div>
    </aside>
  );
}