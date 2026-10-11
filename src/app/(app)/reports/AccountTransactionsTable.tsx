import { AlertCircle, CheckCircle2 } from "lucide-react";
import { formatAmount } from "@/lib/money";
import type { AccountTransactionsReport } from "@/lib/reports/load";

const date = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
const money = (c: number) => formatAmount(c, true);

const typeStyle: Record<string, string> = {
  Expense: "bg-orange-50 text-orange-800",
  Income: "bg-emerald-50 text-emerald-800",
  "Loan payment": "bg-indigo-50 text-indigo-800",
  "Loan proceeds": "bg-indigo-50 text-indigo-800",
  Transfer: "bg-sky-50 text-sky-800",
  "Owner equity": "bg-violet-50 text-violet-800",
  "Opening balance": "bg-slate-100 text-slate-700",
  Reversal: "bg-red-50 text-red-800",
  Journal: "bg-border text-muted",
};

/** Every transaction with its lines stacked: debits first, then credits, so both sides are visible. */
export function AccountTransactionsTable({ report }: { report: AccountTransactionsReport }) {
  const balanced = report.totalDebitsCents === report.totalCreditsCents;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold tracking-tight">{report.title}</h2>
        <p className="text-[13px] text-muted">{report.subtitle}</p>
        <p className="num text-[13px] text-muted">{report.entries.length.toLocaleString("en-US")} transactions</p>
      </div>

      {report.truncated && (
        <div role="status" className="mb-3 flex items-center gap-3 rounded-xl bg-warning-bg px-4 py-2 text-[13px] text-warning-fg">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          Showing the first {report.entries.length.toLocaleString("en-US")} transactions. Narrow the period, property or account to see the rest.
        </div>
      )}

      {report.entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-medium">No transactions in this period</p>
          <p className="mt-1 text-sm text-muted">Try a different date range, business, property or account.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] print:overflow-visible print:shadow-none">
          <table className="w-full border-separate border-spacing-0 text-[13px] leading-5 print:text-[11px]">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th scope="col" className="min-w-24 border-b border-border-strong px-3 py-2">Date</th>
                <th scope="col" className="min-w-56 border-b border-border-strong px-3 py-2">Transaction</th>
                <th scope="col" className="min-w-56 border-b border-border-strong px-3 py-2">Account</th>
                <th scope="col" className="min-w-36 border-b border-border-strong px-3 py-2">Property</th>
                <th scope="col" className="min-w-28 border-b border-border-strong px-3 py-2 text-right">Debit</th>
                <th scope="col" className="min-w-28 border-b border-border-strong px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) =>
                e.lines.map((l, i) => {
                  const first = i === 0;
                  const border = first ? "border-t border-border-strong" : "border-t border-border/50";
                  return (
                    <tr key={`${e.id}-${i}`} className={first ? "bg-brand-50/30" : ""}>
                      <td className={`num whitespace-nowrap px-3 py-1 align-top ${border}`}>{first ? date(e.date) : ""}</td>
                      <td className={`px-3 py-1 align-top ${border}`}>
                        {first && (
                          <>
                            <span className="font-medium">{e.description || "(no description)"}</span>
                            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${typeStyle[e.type] ?? typeStyle.Journal}`}>{e.type}</span>
                            {report.showBusiness && <span className="block text-[12px] text-muted">{e.business}</span>}
                          </>
                        )}
                      </td>
                      <td className={`px-3 py-1 ${l.creditCents > 0 ? "pl-8" : ""} ${border}`}>
                        <span className="num mr-2 text-subtle">{l.code}</span>
                        {l.account}
                      </td>
                      <td className={`px-3 py-1 text-muted ${border}`}>{l.property}</td>
                      <td className={`num px-3 py-1 text-right ${border}`}>{l.debitCents ? money(l.debitCents) : ""}</td>
                      <td className={`num px-3 py-1 text-right ${border}`}>{l.creditCents ? money(l.creditCents) : ""}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50/60 font-semibold">
                <td colSpan={4} className="border-t border-border-strong px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    TOTAL
                    {balanced ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Debits equal credits
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-warning-fg">Debits and credits differ because only some lines are shown</span>
                    )}
                  </span>
                </td>
                <td className="num border-t border-border-strong px-3 py-2 text-right">{money(report.totalDebitsCents)}</td>
                <td className="num border-t border-border-strong px-3 py-2 text-right">{money(report.totalCreditsCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
