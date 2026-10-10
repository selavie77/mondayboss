"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download, Printer } from "lucide-react";
import { Input, Select } from "@/components/ui";
import { REPORTS, toQuery, type ReportParams } from "@/lib/reports/params";

export interface FilterOptions {
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  years: number[];
}

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";

export function ReportControls({ params, options }: { params: ReportParams; options: FilterOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isCapex = params.report === "capital-expenses";

  const go = (patch: Partial<ReportParams>) =>
    start(() => router.replace(`/reports?${toQuery({ ...params, ...patch })}`, { scroll: false }));

  const year = options.years.find((y) => params.from === `${y}-01-01` && params.to === `${y}-12-31`);
  const exportHref = (format: string) => `/reports/export?${toQuery(params)}&format=${format}`;
  const current = REPORTS.find((r) => r.kind === params.report)!;

  return (
    <section aria-label="Report settings" className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="tablist" aria-label="Report type" className="inline-flex gap-1 rounded-lg bg-background p-1">
          {REPORTS.map((r) => (
            <button
              key={r.kind}
              role="tab"
              aria-selected={r.kind === params.report}
              onClick={() => go({ report: r.kind })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                r.kind === params.report ? "bg-surface text-brand-700 shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="hidden min-w-0 flex-1 truncate text-[13px] text-muted xl:block" title={current.description}>
          {current.description}
        </p>

        {!isCapex && (
          <label className="ml-auto inline-flex h-9 items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={params.cents} onChange={(e) => go({ cents: e.target.checked })} className="h-4 w-4 accent-[var(--brand-600)]" />
            Show cents
          </label>
        )}

        <details className={`relative ${isCapex ? "ml-auto" : ""}`}>
          <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
            <Download className="h-4 w-4" aria-hidden /> Export
          </summary>
          <div className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
            <a className="block px-4 py-2 text-sm hover:bg-brand-50" href={exportHref("xlsx")}>
              Excel (.xlsx)
            </a>
            <a className="block px-4 py-2 text-sm hover:bg-brand-50" href={exportHref("csv")}>
              CSV
            </a>
            <button type="button" className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-brand-50" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden /> Print / PDF
            </button>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-3 border-t border-border pt-3" aria-busy={pending}>
        <div className="w-full sm:w-56">
          <label className={label} htmlFor="f-property">
            Property
          </label>
          <Select compact id="f-property" value={params.property} onChange={(e) => go({ property: e.target.value })}>
            <option value="all">All properties</option>
            {options.portfolios.length > 0 && (
              <optgroup label="Portfolios">
                {options.portfolios.map((p) => (
                  <option key={p.id} value={`pf:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Properties">
              {options.properties.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="f-year">
            Period
          </label>
          <div className="flex items-center gap-1.5">
            <Select
              compact
              id="f-year"
              className="w-[5.5rem]"
              value={year ?? "custom"}
              onChange={(e) => {
                const y = e.target.value;
                if (y !== "custom") go({ from: `${y}-01-01`, to: `${y}-12-31` });
              }}
            >
              {options.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
              <option value="custom">Custom</option>
            </Select>
            <Input compact type="date" aria-label="From" className="w-[8.75rem]" value={params.from} onChange={(e) => e.target.value && go({ from: e.target.value })} />
            <span className="text-muted" aria-hidden>
              –
            </span>
            <Input compact type="date" aria-label="To" className="w-[8.75rem]" value={params.to} onChange={(e) => e.target.value && go({ to: e.target.value })} />
          </div>
        </div>

        {!isCapex && (
          <>
            <div>
              <label className={label} htmlFor="f-columns">
                Columns
              </label>
              <Select compact id="f-columns" className="w-36" value={params.columns} onChange={(e) => go({ columns: e.target.value as ReportParams["columns"] })}>
                <option value="property">By property</option>
                <option value="month">By month</option>
                <option value="quarter">By quarter</option>
                <option value="year">By year</option>
                <option value="total">Total only</option>
              </Select>
            </div>
            <div>
              <label className={label} htmlFor="f-detail">
                Detail
              </label>
              <Select compact id="f-detail" className="w-40" value={params.detail} onChange={(e) => go({ detail: e.target.value as ReportParams["detail"] })}>
                <option value="sub">By subcategory</option>
                <option value="category">By category</option>
              </Select>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
