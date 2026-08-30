import type { ReactNode } from "react";

import { CommandCenterLayout } from "@/components/layout/command-center-layout";
import { Topbar } from "@/components/layout/topbar";
import { Sidebar } from "@/components/navigation/sidebar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <CommandCenterLayout
      navigation={<Sidebar />}
      topbar={<Topbar />}
      workspace={children}
      footer={
        <footer className="matrix-footer">
          <span>The Dost Matrix v0.3.1</span>

          <strong>
            BUILDING THE MOST ADVANCED PERSONAL AI OPERATING SYSTEM
          </strong>

          <span>Foundation Phase</span>
        </footer>
      }
    />
  );
}
