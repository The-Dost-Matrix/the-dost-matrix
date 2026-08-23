"use client";

import type { ReactNode } from "react";

type CommandCenterLayoutProps = {
  navigation: ReactNode;
  topbar: ReactNode;
  workspace: ReactNode;
  monitor: ReactNode;
  footer?: ReactNode;
};

export function CommandCenterLayout({
  navigation,
  topbar,
  workspace,
  monitor,
  footer,
}: CommandCenterLayoutProps) {
  return (
    <div className="matrix-os">
      {navigation}

      <div className="matrix-main">
        {topbar}

        <div className="matrix-content-grid">
          <section className="matrix-workspace">
            {workspace}
          </section>

          {monitor}
        </div>

        {footer}
      </div>
    </div>
  );
}