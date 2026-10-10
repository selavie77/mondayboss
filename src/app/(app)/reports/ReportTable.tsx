"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Info } from "lucide-react";
import { formatAmount } from "@/lib/money";
import type { ReportData, ReportRow } from "@/lib/reports/types";

const rowStyle: Record<ReportRow["kind"], string> = {
  heading: "",
  gap: "",
  line: "",
  subline: "text-muted",
  total: "font-medium",
  grand: "font-semibold",
  ratio: "text-muted italic",
};

function cell(row: ReportRow, v: number | null | undefined, cents: boolean) {
  if (v === null || v === undefined) return "–";
  if (row.kind === "ratio") return `${v.toFixed(2)}x`;
  return formatAmount(v, cents);
}

const catKey = (row: ReportRow) => `${row.section ?? ""}|${row.cat ?? ""}`;

export function ReportTable({ data, cents }: { data: ReportData; cents: boolean }) {
  const hasTotal = data.columns.at(-1) === "Total" && data.columns.length > 1;
  const colCount = data.columns.length + 1;

  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
  const [closedCats, setClosedCats] = useState<Set<string>>(new Set());

  const sections = useMemo(() => data.rows.filter((r) => r.kind === "heading").map((r) => r.label), [data.rows]);
  const cats = useMemo(() => [...new Set(data.rows.filter((r) => r.catHead).map(catKey))], [data.rows]);
  const collapsible = sections.length > 0;
  const allClosed = sections.every((s) => closedSections.has(s)) && cats.every((c) => closedCats.has(c));

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const hidden = (row: ReportRow) => {
    if (row.kind === "heading" || row.kind === "gap") return false;
    if (row.section && closedSections.has(row.section) && !row.summary) return true;
    if (row.cat && !row.catHead && closedCats.has(catKey(row))) return true;
    return false;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{data.title}</h2>
        <p className="text-[13px] text-muted">{data.subtitle}</p>
        {collapsible && !data.empty && (
          <div className="ml-auto flex gap-1 print:hidden">
            <button
              type="button"
              onClick={() => {
                setClosedSections(new Set());
                setClosedCats(new Set());
              }}
              disabled={closedSections.size === 0 && closedCats.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition hover:bg-brand-50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronsUpDown className="h-4 w-4" aria-hidden /> Expand all
            </button>
            <button
              type="button"
              onClick={() => {
                setClosedSections(new Set(sections));
                setClosedCats(new Set(cats));
              }}
              disabled={allClosed}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition hover:bg-brand-50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronsDownUp className="h-4 w-4" aria-hidden /> Collapse all
            </button>
          </div>
        )}
      </div>

      {data.notes && data.notes.length > 0 && (
        <ul className="mb-3 space-y-1.5" aria-label="Notes">
          {data.notes.map((n, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 rounded-xl px-3.5 py-2 text-[13px] ${
                n.tone === "ok" ? "bg-brand-50 text-brand-900" : n.tone === "warn" ? "bg-warning-bg text-warning-fg" : "bg-background text-muted"
              }`}
            >
              {n.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : n.tone === "warn" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <span>
                {n.text}
                {n.link && (
                  <>
                    {" "}
                    <a href={n.link.href} className="font-semibold underline underline-offset-2">
                      {n.link.label}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.empty ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-medium">No activity in this period</p>
          <p className="mt-1 text-sm text-muted">Try a different date range or property.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] print:overflow-visible print:shadow-none">
          <table className="w-full border-separate border-spacing-0 text-[13px] leading-5 print:text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-60 min-w-52 border-b border-border-strong bg-surface px-3 py-2 text-left" aria-label="Category" />
                {data.columns.map((c, i) => (
                  <th
                    key={c + i}
                    scope="col"
                    className={`min-w-[4.9rem] border-b border-border-strong px-2.5 py-2 text-right align-bottom text-xs font-semibold leading-tight ${
                      hasTotal && i === data.columns.length - 1 ? "bg-brand-50 text-brand-900" : "bg-surface text-muted"
                    }`}
                  >
                    <span className="inline-block max-w-[7rem] whitespace-normal">{c}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                if (hidden(row)) return null;

                if (row.kind === "gap") {
                  return (
                    <tr key={i} aria-hidden>
                      <td colSpan={colCount} className="h-1.5" />
                    </tr>
                  );
                }

                if (row.kind === "heading") {
                  const closed = closedSections.has(row.label);
                  return (
                    <tr key={i}>
                      <th colSpan={colCount} scope="colgroup" className="sticky left-0 bg-background p-0 text-left">
                        <button
                          type="button"
                          aria-expanded={!closed}
                          onClick={() => toggle(closedSections, setClosedSections, row.label)}
                          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-700 hover:bg-brand-50/60 print:cursor-default"
                        >
                          {closed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                          {row.label}
                        </button>
                      </th>
                    </tr>
                  );
                }

                const strong = row.kind === "grand" || row.kind === "total";
                const border = strong ? "border-t border-border-strong" : "border-t border-border/70";
                const bg = row.kind === "grand" ? "bg-brand-50/60" : "bg-surface";
                const isCatHead = Boolean(row.catHead);
                const catClosed = isCatHead && closedCats.has(catKey(row));
                const label = catClosed && row.catName ? row.catName : row.label;

                return (
                  <tr key={i} className={rowStyle[row.kind]}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 px-3 py-0.5 text-left font-[inherit] ${border} ${bg} ${row.kind === "subline" ? "pl-7" : ""}`}
                    >
                      {isCatHead ? (
                        <button
                          type="button"
                          aria-expanded={!catClosed}
                          onClick={() => toggle(closedCats, setClosedCats, catKey(row))}
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-left hover:bg-brand-50 print:cursor-default"
                        >
                          {catClosed ? <ChevronRight className="h-3.5 w-3.5 text-subtle" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 text-subtle" aria-hidden />}
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                    {data.columns.map((_, ci) => {
                      const v = row.values?.[ci];
                      const isTotalCol = hasTotal && ci === data.columns.length - 1;
                      return (
                        <td
                          key={ci}
                          className={`num whitespace-nowrap px-2.5 py-0.5 text-right ${border} ${
                            isTotalCol && row.kind !== "grand" ? "bg-brand-50/40" : bg
                          } ${typeof v === "number" && v < 0 ? "text-negative" : ""} ${
                            v === 0 && row.kind !== "ratio" ? "text-subtle" : ""
                          }`}
                        >
                          {cell(row, v, cents)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
