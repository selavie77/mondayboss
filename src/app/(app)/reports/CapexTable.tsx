import { formatAmount } from "@/lib/money";
import type { CapexRow } from "@/lib/reports/load";

const date = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "–";

export function CapexTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: CapexRow[] }) {
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-12 text-center">
          <p className="font-medium">No capital expenses yet</p>
          <p className="mt-1 text-sm text-muted">Add a purchase or improvement to start your depreciation schedule.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] print:overflow-visible print:shadow-none">
          <table className="w-full min-w-max border-separate border-spacing-0 text-[15px]">
            <thead>
              <tr className="text-left text-sm font-semibold text-muted">
                {["Date", "Name", "Type", "Amount", "Placed in service", "Useful life", "Property", "Notes"].map((h) => (
                  <th key={h} scope="col" className={`border-b border-border-strong px-4 py-3 ${h === "Amount" || h === "Useful life" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num border-t border-border px-4 py-2.5">{date(r.spentOn)}</td>
                  <td className="border-t border-border px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="border-t border-border px-4 py-2.5 text-muted">{r.subCategory}</td>
                  <td className="num border-t border-border px-4 py-2.5 text-right">{formatAmount(r.amountCents, false)}</td>
                  <td className="num border-t border-border px-4 py-2.5">{date(r.placedInService)}</td>
                  <td className="num border-t border-border px-4 py-2.5 text-right">{r.usefulLife} yrs</td>
                  <td className="border-t border-border px-4 py-2.5">
                    {r.property}
                    {r.portfolio && <span className="block text-[13px] text-muted">{r.portfolio}</span>}
                  </td>
                  <td className="border-t border-border px-4 py-2.5 text-muted">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50/60 font-semibold">
                <td colSpan={3} className="border-t border-border-strong px-4 py-3">
                  TOTAL CAPITAL EXPENSES
                </td>
                <td className="num border-t border-border-strong px-4 py-3 text-right">{formatAmount(total, false)}</td>
                <td colSpan={4} className="border-t border-border-strong" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
