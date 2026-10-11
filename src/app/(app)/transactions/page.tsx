import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { formatAmount } from "@/lib/money";
import { getSession } from "@/lib/workspace";
import { loadTransactions, parseTransactionParams, transactionQuery, type TransactionRow } from "@/lib/transactions/list";
import { ReverseButton } from "./ReverseButton";

export const metadata: Metadata = { title: "Transactions" };

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const money = (c: number) => formatAmount(c, true);
const date = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const sp = await searchParams;
  const { supabase } = await getSession();
  const { data: last } = await supabase.from("journal_entries").select("entry_date").order("entry_date", { ascending: false }).limit(1);
  const latest = last?.[0]?.entry_date ? Number(last[0].entry_date.slice(0, 4)) : new Date().getFullYear();

  const params = parseTransactionParams(sp, latest);
  const list = await loadTransactions(params);
  const page = Math.min(params.page, list.pageCount);
  const href = (patch: Partial<typeof params>) => `/transactions?${transactionQuery(params, patch)}`;
  const year = list.years.find((y) => params.from === `${y}-01-01` && params.to === `${y}-12-31`);
  const from = (page - 1) * 50 + 1;
  const to = Math.min(page * 50, list.total);

  return (
    <div className="space-y-4">
      <header className="rise">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted">Everything in your books, newest first. Open a transaction to see its debits and credits.</p>
      </header>

      <form
        method="get"
        action="/transactions"
        aria-label="Filter transactions"
        className="rise flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]"
      >
        <div className="w-full sm:w-56">
          <label className={label} htmlFor="t-q">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-subtle" aria-hidden />
            <Input compact id="t-q" name="q" defaultValue={params.q} placeholder="Description" className="pl-8" />
          </div>
        </div>

        {list.showBusiness && (
          <div className="w-full sm:w-48">
            <label className={label} htmlFor="t-entity">
              Business
            </label>
            <Select compact id="t-entity" name="entity" defaultValue={params.entity}>
              <option value="all">All businesses</option>
              {list.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="w-full sm:w-52">
          <label className={label} htmlFor="t-property">
            Property
          </label>
          <Select compact id="t-property" name="property" defaultValue={params.property}>
            <option value="all">All properties</option>
            {list.portfolios.length > 0 && (
              <optgroup label="Portfolios">
                {list.portfolios.map((p) => (
                  <option key={p.id} value={`pf:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Properties">
              {list.properties.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>

        <div className="w-full sm:w-56">
          <label className={label} htmlFor="t-account">
            Account
          </label>
          <Select compact id="t-account" name="account" defaultValue={params.account}>
            <option value="all">All accounts</option>
            {list.accountOptions.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="t-from">
            Period
          </label>
          <div className="flex items-center gap-1.5">
            <Input compact id="t-from" type="date" name="from" aria-label="From" className="w-[8.75rem]" defaultValue={params.from} />
            <span className="text-muted" aria-hidden>
              –
            </span>
            <Input compact type="date" name="to" aria-label="To" className="w-[8.75rem]" defaultValue={params.to} />
          </div>
        </div>

        <label className="inline-flex h-9 items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="reversed" value="1" defaultChecked={params.showReversed} className="h-4 w-4 accent-[var(--brand-600)]" />
          Show reversed
        </label>

        <Button type="submit" size="sm">
          Apply
        </Button>
      </form>

      {list.years.length > 1 && (
        <nav aria-label="Jump to a year" className="rise flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">Year:</span>
          {list.years.map((y) => (
            <Link
              key={y}
              href={href({ from: `${y}-01-01`, to: `${y}-12-31`, page: 1 })}
              aria-current={year === y ? "true" : undefined}
              className={`rounded-full px-3 py-1 font-medium ${year === y ? "bg-brand-600 text-white" : "bg-surface text-muted ring-1 ring-border hover:bg-brand-50"}`}
            >
              {y}
            </Link>
          ))}
        </nav>
      )}

      {list.rows.length === 0 ? (
        <div className="rise rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-medium">No transactions match</p>
          <p className="mt-1 text-sm text-muted">Try a different period or clear the search and filters. New ones start with Add transaction.</p>
        </div>
      ) : (
        <div className="rise overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
          <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.1fr)_8rem] gap-3 border-b border-border-strong px-4 py-2 text-xs font-semibold text-muted md:grid">
            <span>Date</span>
            <span>Description</span>
            <span>Account</span>
            <span className="text-right">Amount</span>
          </div>
          <ul>
            {list.rows.map((r) => (
              <TransactionItem key={r.id} r={r} showBusiness={list.showBusiness} />
            ))}
          </ul>
        </div>
      )}

      {list.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p className="num">
            {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {list.total.toLocaleString("en-US")}
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border-strong bg-surface px-3 font-medium text-foreground hover:bg-brand-50">
                <ChevronLeft className="h-4 w-4" aria-hidden /> Newer
              </Link>
            ) : null}
            {page < list.pageCount ? (
              <Link href={href({ page: page + 1 })} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border-strong bg-surface px-3 font-medium text-foreground hover:bg-brand-50">
                Older <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function TransactionItem({ r, showBusiness }: { r: TransactionRow; showBusiness: boolean }) {
  return (
    <li className="border-b border-border/70 last:border-b-0">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-brand-50/40 md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.1fr)_8rem]">
          <span className="num order-1 text-[13px] text-muted md:order-none">{date(r.date)}</span>
          <span className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
            <span className={`truncate font-medium ${r.isReversed ? "text-muted line-through" : ""}`}>{r.description || "(no description)"}</span>
            <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${typeStyle[r.type] ?? typeStyle.Journal}`}>{r.type}</span>
            {r.isReversed && <span className="ml-1.5 rounded-full bg-red-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-red-800">Reversed</span>}
            <span className="block truncate text-[12px] text-muted">
              {[showBusiness ? r.business : "", ...r.propertyNames].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="order-4 col-span-2 truncate text-[13px] text-muted md:order-none md:col-span-1">{r.summary}</span>
          <span className="num order-2 flex items-center justify-end gap-1.5 text-right font-medium md:order-none">
            {money(r.amountCents)}
            <ChevronDown className="h-4 w-4 text-subtle transition group-open:rotate-180" aria-hidden />
          </span>
        </summary>

        <div className="space-y-3 bg-brand-50/30 px-4 pb-4 pt-1 md:pl-[7.75rem]">
          <table className="w-full max-w-3xl border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th scope="col" className="border-b border-border-strong py-1.5 pr-3">Account</th>
                <th scope="col" className="hidden border-b border-border-strong py-1.5 pr-3 sm:table-cell">Property</th>
                <th scope="col" className="border-b border-border-strong py-1.5 pl-3 text-right">Debit</th>
                <th scope="col" className="border-b border-border-strong py-1.5 pl-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td className={`border-b border-border/60 py-1.5 pr-3 ${l.creditCents > 0 ? "pl-5" : ""}`}>
                    <span className="num mr-2 text-subtle">{l.code}</span>
                    {l.account}
                  </td>
                  <td className="hidden border-b border-border/60 py-1.5 pr-3 text-muted sm:table-cell">{l.property}</td>
                  <td className="num border-b border-border/60 py-1.5 pl-3 text-right">{l.debitCents ? money(l.debitCents) : ""}</td>
                  <td className="num border-b border-border/60 py-1.5 pl-3 text-right">{l.creditCents ? money(l.creditCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.canReverse ? (
            <ReverseButton entryId={r.id} description={r.description} />
          ) : r.isReversal ? (
            <p className="text-[13px] text-muted">This reversal cancels an earlier transaction.</p>
          ) : r.isReversed ? (
            <p className="text-[13px] text-muted">Reversed. A matching reversal is in the books.</p>
          ) : r.type === "Opening balance" ? (
            <p className="text-[13px] text-muted">Change opening balances on the account in Categories.</p>
          ) : null}
        </div>
      </details>
    </li>
  );
}
