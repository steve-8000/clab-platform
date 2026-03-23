"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <html lang="ko" className="dark">
      <body className="bg-black text-white antialiased">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className="min-h-screen bg-black lg:ml-60">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
