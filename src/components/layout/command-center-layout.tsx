"use client";

import type { ReactNode } from "react";

type CommandCenterLayoutProps = {
  navigation: ReactNode;
  topbar: ReactNode;
  workspace: ReactNode;
  footer?: ReactNode;
};

export function CommandCenterLayout({
  navigation,
  topbar,
  workspace,
  footer,
}: CommandCenterLayoutProps) {
  return (
    <div className="matrix-os">
      {navigation}

      <div className="matrix-main">
        {topbar}

        <div className="matrix-content-grid matrix-content-grid--full">
          <section className="matrix-workspace matrix-workspace--full">
            {workspace}
          </section>
        </div>

        {footer}
      </div>
    </div>
  );
}