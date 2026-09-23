import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elvin Agent Testbed",
  description: "Paste an OpenAI-compatible agent endpoint, tune the UI, and export the exact source.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning >
      <body>{children}</body>
    </html>
  );
}
