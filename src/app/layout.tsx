import type { Metadata } from "next";
import { AuthProvider } from "@/domains/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Dost Matrix",
  description: "Het AI-besturingssysteem van Elroy Dost.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
