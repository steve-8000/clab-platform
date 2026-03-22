"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◉" },
  { href: "/threads", label: "Threads", icon: "⟳" },
  { href: "/agents", label: "Agents", icon: "⚡" },
  { href: "/knowledge", label: "Knowledge", icon: "◈" },
  { href: "/interrupts", label: "Interrupts", icon: "⚠" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-gray-800 bg-gray-950">
      <div className="flex h-14 items-center border-b border-gray-800 px-4">
        <span className="text-lg font-bold text-white">clab</span>
        <span className="ml-1 text-xs text-gray-500">platform</span>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-800 p-4">
        <div className="text-xs text-gray-600">Control Plane + Knowledge + cmux</div>
      </div>
    </aside>
  );
}
