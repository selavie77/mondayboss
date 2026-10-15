"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/properties", label: "Properties" },
  { href: "/portfolios", label: "Portfolios" },
  { href: "/entities", label: "Legal entities" },
];

/** Switch between the three lists that describe what you own and who owns it. */
export function RealEstateTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Real estate" className="flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
