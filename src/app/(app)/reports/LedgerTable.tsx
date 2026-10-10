"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { formatAmount } from "@/lib/money";
import type { LedgerReport } from "@/lib/reports/load";

const date = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
const money = (c: number) => formatAmount(c, true);

export function LedgerTable({ report }: { report: LedgerReport }) {
  const { groups } = report;
  // One account: show its lines right away. Many accounts: start collapsed to the account totals.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.length === 1 ? groups.map((g) => g.account.id) : []));
  const allOpen = groups.length > 0 && groups.every((g) => open.has(g.account.id));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{report.title}</h2>
        <p className="text-[13px] text-muted">{report.subtitle}</p>
        {groups.length > 1 && (
          <div className="ml-auto flex gap-1 print:hidden">
            <button
              type="button"
              onClick={() => setOpen(new Set(groups.map((g) => g.account.id)))}
              disabled={allOpen}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition hover:bg-brand-50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronsUpDown className="h-4 w-4" aria-hidden /> Expand all
            </button>
            <button
              type="button"
              onClick={() => setOpen(new Set())}
              disabled={open.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted transition hover:bg-brand-50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronsDownUp className="h-4 w-4" aria-hidden /> Collapse all
            </button>
          </div>
        )}
      </div>

      {report.truncated && (
        <div role="status" className="mb-3 flex items-center gap-3 rounded-xl bg-warning-bg px-4 py-2 text-[13px] text-warning-fg">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          Showing the first {report.lineCount.toLocaleString("en-US")} lines. Narrow the period, property or account to see the rest.
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-medium">No entries in this period</p>
          <p className="mt-1 text-sm text-muted">Try a different date range, property or account.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] print:overflow-visible print:shadow-none">
          <table className="w-full border-separate border-spacing-0 text-[13px] leading-5 print:text-[11px]">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th scope="col" className="min-w-24 border-b border-border-strong px-3 py-2">Date</th>
                <th scope="col" className="min-w-64 border-b border-border-strong px-3 py-2">Description</th>
                <th scope="col" className="min-w-40 border-b border-border-strong px-3 py-2">Property</th>
                <th scope="col" className="min-w-28 border-b border-border-strong px-3 py-2 text-right">Debit</th>
                <th scope="col" className="min-w-28 border-b border-border-strong px-3 py-2 text-right">Credit</th>
                <th scope="col" className="min-w-28 border-b border-border-strong px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const isOpen = open.has(g.account.id);
              return (
                <tbody key={g.account.id}>
                  <tr className="bg-brand-50/50">
                    <th colSpan={3} scope="colgroup" className="p-0 text-left">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => toggle(g.account.id)}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-brand-50 print:cursor-default"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4 text-subtle" aria-hidden /> : <ChevronRight className="h-4 w-4 text-subtle" aria-hidden />}
                        <span className="num font-normal text-muted">{g.account.code}</span>
                        {g.account.parentName ? `${g.account.parentName} › ` : ""}
                        {g.account.name}
                        <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 num">{g.entries.length}</span>
                      </button>
                    </th>
                    <td className="num px-3 py-1.5 text-right font-semibold">{money(g.debitsCents)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{money(g.creditsCents)}</td>
                    <td className={`num px-3 py-1.5 text-right font-semibold ${g.closingCents < 0 ? "text-negative" : ""}`}>{money(g.closingCents)}</td>
                  </tr>

                  {isOpen && (
                    <>
                      <tr className="text-muted">
                        <td className="border-t border-border/70 px-3 py-0.5 num">{""}</td>
                        <td colSpan={4} className="border-t border-border/70 px-3 py-0.5 italic">
                          Opening balance
                        </td>
                        <td className="num border-t border-border/70 px-3 py-0.5 text-right">{money(g.openingCents)}</td>
                      </tr>
                      {g.entries.map((e, i) => (
                        <tr key={i}>
                          <td className="num whitespace-nowrap border-t border-border/70 px-3 py-0.5">{date(e.date)}</td>
                          <td className="border-t border-border/70 px-3 py-0.5">{e.description}</td>
                          <td className="border-t border-border/70 px-3 py-0.5 text-muted">{e.property}</td>
                          <td className="num border-t border-border/70 px-3 py-0.5 text-right">{e.debitCents ? money(e.debitCents) : ""}</td>
                          <td className="num border-t border-border/70 px-3 py-0.5 text-right">{e.creditCents ? money(e.creditCents) : ""}</td>
                          <td className={`num border-t border-border/70 px-3 py-0.5 text-right ${e.balanceCents < 0 ? "text-negative" : ""}`}>
                            {money(e.balanceCents)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}
