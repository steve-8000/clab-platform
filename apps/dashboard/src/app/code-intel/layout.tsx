"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SUBNAV = [
  { href: "/code-intel", label: "Repositories" },
  { href: "/code-intel/explorer", label: "Graph Explorer" },
  { href: "/code-intel/impact", label: "Impact Analysis" },
  { href: "/code-intel/findings", label: "Structural Findings" },
  { href: "/code-intel/hotspots", label: "Hotspots" },
];

const TOP_LEVEL_SUBPAGES = new Set(["explorer", "impact", "findings", "hotspots"]);

export default function CodeIntelLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <nav className="rounded-xl border border-white/[0.06] bg-black p-2">
        <div className="flex flex-wrap gap-2">
          {SUBNAV.map((item) => {
            const detailSegment = pathname.split("/")[2];
            const isRepoDetail =
              pathname.startsWith("/code-intel/") &&
              Boolean(detailSegment) &&
              !TOP_LEVEL_SUBPAGES.has(detailSegment);
            const active = item.href === "/code-intel"
              ? pathname === "/code-intel" || isRepoDetail
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/[0.06] text-white"
                    : "text-neutral-400 hover:bg-neutral-950 hover:text-neutral-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
