import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elvin Agent Testbed",
  description: "A lightweight front-end for an OpenAI-compatible agent: a chat UI for testing, with duration and token measurement.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning >
      <body>{children}</body>
    </html>
  );
}
