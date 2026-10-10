"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Building2, FileBarChart, Sun, Upload } from "lucide-react";

const items = [
  { href: "/monday", label: "Monday", icon: Sun },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "#", label: "Import", icon: Upload, soon: true },
  { href: "#", label: "Ledger", icon: BookOpen, soon: true },
  { href: "#", label: "Reports", icon: FileBarChart, soon: true },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map(({ href, label, icon: Icon, soon }) => {
        const active = !soon && pathname.startsWith(href);
        const base = "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition";
        if (soon) {
          return (
            <span key={label} aria-disabled className={`${base} cursor-default text-subtle`}>
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              {label}
              <span className="ml-auto rounded-full bg-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Soon
              </span>
            </span>
          );
        }
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${base} ${active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-brand-50/60 hover:text-foreground"}`}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
