import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "clab Dashboard", description: "Execution Control Plane" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">clab</h1>
          <span className="text-sm text-gray-400">Execution Control Plane</span>
        </nav>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
