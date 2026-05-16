import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luna Wolves",
  description: "WoW Guild Companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
