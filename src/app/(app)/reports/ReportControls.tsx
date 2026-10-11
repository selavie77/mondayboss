"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download, Printer } from "lucide-react";
import { Input, Select } from "@/components/ui";
import { AS_OF_REPORTS, toQuery, type ReportParams } from "@/lib/reports/params";

export interface FilterOptions {
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  years: number[];
  /** General ledger only: accounts that can be picked. */
  accounts?: { code: string; name: string }[];
  /** The businesses (entities). The business filter and "By business" columns appear when there is more than one. */
  entities?: { id: string; name: string }[];
}

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";

export function ReportControls({ params, options }: { params: ReportParams; options: FilterOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const kind = params.report;
  const asOf = AS_OF_REPORTS.includes(kind);
  const isLedger = kind === "general-ledger";
  const showColumns = kind === "income-statement" || kind === "net-cash-flow" || kind === "balance-sheet";
  const showDetail = showColumns;
  const showCents = kind !== "capital-expenses" && !isLedger;

  const go = (patch: Partial<ReportParams>) =>
    start(() => router.replace(`/reports/${params.report}?${toQuery({ ...params, ...patch }, false)}`, { scroll: false }));

  const entities = options.entities ?? [];
  const multi = entities.length > 1;
  const year = options.years.find((y) => params.from === `${y}-01-01` && params.to === `${y}-12-31`);
  const yearEnd = options.years.find((y) => params.to === `${y}-12-31`);
  const exportHref = (format: string) => `/reports/export?${toQuery(params)}&format=${format}`;

  return (
    <section
      aria-label="Report settings"
      aria-busy={pending}
      className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] print:hidden"
    >
      {multi && (
        <div className="w-full sm:w-52">
          <label className={label} htmlFor="f-entity">
            Business
          </label>
          <Select compact id="f-entity" value={params.entity} onChange={(e) => go({ entity: e.target.value })}>
            <option value="all">All businesses (combined)</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </Select>
        </div>
      )}

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

      {asOf ? (
        <div>
          <label className={label} htmlFor="f-asof">
            As of
          </label>
          <div className="flex items-center gap-1.5">
            <Select
              compact
              id="f-asof"
              className="w-36"
              value={yearEnd ? String(yearEnd) : "custom"}
              onChange={(e) => {
                const y = e.target.value;
                if (y !== "custom") go({ to: `${y}-12-31` });
              }}
            >
              {options.years.map((y) => (
                <option key={y} value={y}>
                  Dec 31, {y}
                </option>
              ))}
              <option value="custom">Custom date</option>
            </Select>
            <Input compact type="date" aria-label="As of date" className="w-[8.75rem]" value={params.to} onChange={(e) => e.target.value && go({ to: e.target.value })} />
          </div>
        </div>
      ) : (
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
      )}

      {isLedger && (
        <div className="w-full sm:w-64">
          <label className={label} htmlFor="f-account">
            Account
          </label>
          <Select compact id="f-account" value={params.account} onChange={(e) => go({ account: e.target.value })}>
            <option value="all">All accounts</option>
            {(options.accounts ?? []).map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {showColumns && (
        <div>
          <label className={label} htmlFor="f-columns">
            Columns
          </label>
          <Select compact id="f-columns" className="w-36" value={params.columns} onChange={(e) => go({ columns: e.target.value as ReportParams["columns"] })}>
            <option value="property">By property</option>
            {multi && <option value="entity">By business</option>}
            {kind !== "balance-sheet" && (
              <>
                <option value="month">By month</option>
                <option value="quarter">By quarter</option>
                <option value="year">By year</option>
              </>
            )}
            <option value="total">Total only</option>
          </Select>
        </div>
      )}
      {showDetail && (
        <div>
          <label className={label} htmlFor="f-detail">
            Detail
          </label>
          <Select compact id="f-detail" className="w-40" value={params.detail} onChange={(e) => go({ detail: e.target.value as ReportParams["detail"] })}>
            <option value="sub">By subcategory</option>
            <option value="category">By category</option>
          </Select>
        </div>
      )}
      {showCents && (
        <label className="inline-flex h-9 items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={params.cents} onChange={(e) => go({ cents: e.target.checked })} className="h-4 w-4 accent-[var(--brand-600)]" />
          Show cents
        </label>
      )}

      <details className="relative ml-auto">
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
    </section>
  );
}
