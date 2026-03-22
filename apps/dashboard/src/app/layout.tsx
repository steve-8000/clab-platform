import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import "./globals.css";

export const metadata: Metadata = {
  title: "clab platform",
  description: "Multi-agent orchestration dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        <Sidebar />
        <div className="ml-56 min-h-screen">
          <Header />
          <main className="p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
