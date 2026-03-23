"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  children?: NavItem[];
};

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "01" },
  { href: "/threads", label: "Threads", icon: "02" },
  { href: "/agents", label: "Runtime", icon: "03" },
  {
    href: "/knowledge",
    label: "Knowledge",
    icon: "05",
    children: [
      { href: "/knowledge", label: "Search", icon: "A" },
      { href: "/knowledge/profile", label: "Profile", icon: "B" },
      { href: "/knowledge/insights", label: "Insights", icon: "C" },
      { href: "/knowledge/debt", label: "Debt", icon: "D" },
      { href: "/knowledge/graph", label: "Graph", icon: "E" },
    ],
  },
  { href: "/interrupts", label: "Interrupts", icon: "06" },
  { href: "/code-intel", label: "Code Intel", icon: "07" },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [knowledgeOpen, setKnowledgeOpen] = useState(pathname.startsWith("/knowledge"));

  useEffect(() => {
    if (pathname.startsWith("/knowledge")) {
      setKnowledgeOpen(true);
    }
  }, [pathname]);

  const getItemClassName = (active: boolean) =>
    [
      "group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-colors",
      active
        ? "border-white/[0.08] bg-white/[0.06] text-white"
        : "border-transparent text-neutral-400 hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-white",
    ].join(" ");

  const getChildClassName = (active: boolean) =>
    [
      "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
      active
        ? "border-white/[0.08] bg-white/[0.05] text-white"
        : "border-transparent text-neutral-400 hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-white",
    ].join(" ");

  return (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/[0.06] bg-black transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-600">clab</p>
          <h1 className="mt-1 text-xl font-semibold text-white">Platform</h1>
        </div>
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] text-neutral-400 transition-colors hover:text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-2">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

            if (item.children) {
              return (
                <div key={item.href} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setKnowledgeOpen((current) => !current)}
                    className={getItemClassName(active)}
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] text-[11px] text-neutral-500">
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left">{item.label}</span>
                    <span className="text-xs text-neutral-600">{knowledgeOpen ? "−" : "+"}</span>
                  </button>

                  {knowledgeOpen && (
                    <div className="space-y-2 pl-4">
                      {item.children.map((child) => {
                        const childActive = pathname === child.href;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onClose}
                            className={getChildClassName(childActive)}
                          >
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] text-[10px] text-neutral-500">
                              {child.icon}
                            </span>
                            <span>{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={getItemClassName(active)}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] text-[11px] text-neutral-500">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/[0.06] px-5 py-4">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-600">System Mesh</p>
        <p className="mt-2 text-sm text-neutral-400">Control Plane, Knowledge, cmux runtime.</p>
      </div>
    </aside>
  );
}
