"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderClosed, Home, Search, Star } from "lucide-react";
import { Input } from "@/components/ui";
import { CATEGORIES, type CatalogItem } from "@/lib/reports/catalog";
import { StarButton } from "./StarButton";

export interface CenterItem extends CatalogItem {
  favorite: boolean;
  lastVisited: string | null;
}

const navBase = "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition";

function navClass(active: boolean) {
  return `${navBase} ${active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-brand-50/60 hover:text-foreground"}`;
}

export function ReportsCenter({ items, view, category }: { items: CenterItem[]; view: "all" | "favorites"; category: string | null }) {
  const [favs, setFavs] = useState(() => new Set(items.filter((i) => i.favorite).map((i) => i.key)));
  const [query, setQuery] = useState("");

  const categoryLabel = (key: string) => CATEGORIES.find((c) => c.key === key)?.label ?? key;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (view === "favorites" && !favs.has(i.key)) return false;
      if (category && i.category !== category) return false;
      if (!q) return true;
      return `${i.name} ${i.description} ${categoryLabel(i.category)}`.toLowerCase().includes(q);
    });
  }, [items, view, category, favs, query]);

  const title = view === "favorites" ? "Favorites" : category ? categoryLabel(category) : "All Reports";
  const setFav = (key: string, on: boolean) =>
    setFavs((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <aside aria-label="Report navigation" className="h-fit rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
        <nav className="space-y-1">
          <Link href="/reports" aria-current={view === "all" && !category ? "page" : undefined} className={navClass(view === "all" && !category)}>
            <Home className="h-[18px] w-[18px]" aria-hidden /> Home
          </Link>
          <Link href="/reports?view=favorites" aria-current={view === "favorites" ? "page" : undefined} className={navClass(view === "favorites")}>
            <Star className="h-[18px] w-[18px]" aria-hidden /> Favorites
            {favs.size > 0 && <span className="ml-auto rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 num">{favs.size}</span>}
          </Link>
        </nav>

        <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">Report category</p>
        <nav className="space-y-1">
          {CATEGORIES.map((c) => {
            const count = items.filter((i) => i.category === c.key).length;
            const active = view === "all" && category === c.key;
            return (
              <Link key={c.key} href={`/reports?category=${c.key}`} aria-current={active ? "page" : undefined} className={navClass(active)}>
                <FolderClosed className="h-[18px] w-[18px]" aria-hidden /> {c.label}
                <span className="ml-auto text-xs font-normal text-subtle num">{count}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <section aria-labelledby="center-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id="center-title" className="flex items-center gap-2.5 text-lg font-semibold">
            {title}
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-sm font-semibold text-brand-700 num">{visible.length}</span>
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              compact
              type="search"
              aria-label="Search reports"
              placeholder="Search reports"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-medium">{view === "favorites" && !query ? "No favorites yet" : "No reports found"}</p>
            <p className="mt-1 text-sm text-muted">
              {view === "favorites" && !query ? "Click the star next to a report to keep it here." : "Try a different search or category."}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th scope="col" className="px-5 py-2.5">Report name</th>
                <th scope="col" className="hidden px-3 py-2.5 md:table-cell">Category</th>
                <th scope="col" className="hidden px-5 py-2.5 text-right sm:table-cell">Last visited</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} className="border-b border-border/70 last:border-b-0 hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      {r.available ? (
                        <StarButton reportKey={r.key} initial={favs.has(r.key)} onChange={(on) => setFav(r.key, on)} size="sm" />
                      ) : (
                        <span className="w-8 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0">
                        {r.available ? (
                          <Link href={`/reports/${r.key}`} className="font-medium text-brand-700 hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          <span className="flex items-center gap-2 font-medium text-muted">
                            {r.name}
                            <span className="rounded-full bg-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Soon</span>
                          </span>
                        )}
                        <p className="mt-0.5 max-w-xl text-[13px] text-muted">{r.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-[15px] md:table-cell">{categoryLabel(r.category)}</td>
                  <td className="hidden px-5 py-3 text-right text-sm text-muted sm:table-cell" suppressHydrationWarning>
                    {r.lastVisited
                      ? new Date(r.lastVisited).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
