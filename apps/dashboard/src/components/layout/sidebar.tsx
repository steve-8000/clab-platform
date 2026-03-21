"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "\u25A0" },
  { href: "/missions", label: "Missions", icon: "\u25B6" },
  { href: "/sessions", label: "Sessions", icon: "\u25C9" },
  { href: "/knowledge", label: "Knowledge", icon: "\u25C6" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white tracking-tight">clab-platform</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">Orchestration Control Plane</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 border border-transparent"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-gray-800">
        <p className="text-[10px] text-gray-600">v2.0.0</p>
      </div>
    </aside>
  );
}
