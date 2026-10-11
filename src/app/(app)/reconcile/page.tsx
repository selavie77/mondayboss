import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui";
import { formatAmount } from "@/lib/money";
import { isCashLike } from "@/lib/paidFrom";
import { monthEnd } from "@/lib/reconcile";
import { getSession } from "@/lib/workspace";
import { ReconcileControls, ReconcileForm, UndoReconciliation, type ReconcileRow } from "./ReconcileForm";

export const metadata: Metadata = { title: "Reconcile" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const PAGE = 1000;

type LineRow = {
  line_id: string;
  entry_date: string;
  memo: string | null;
  property_id: string | null;
  debit_cents: number | string;
  credit_cents: number | string;
  other_accounts: string | null;
};

export default async function ReconcilePage({ searchParams }: PageProps<"/reconcile">) {
  const sp = await searchParams;
  const { supabase } = await getSession();

  const [{ data: accts }, { data: entities }, { data: props }] = await Promise.all([
    supabase.from("accounts").select("id, code, name, type, subtype, is_bank, last4, entity_id").eq("is_active", true).order("code"),
    supabase.from("entities").select("id, name"),
    supabase.from("properties").select("id, name"),
  ]);
  const entityName = new Map((entities ?? []).map((e) => [e.id as string, e.name as string]));
  const propertyName = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  const cash = (accts ?? [])
    .filter((a) => isCashLike({ isBank: a.is_bank as boolean, subtype: a.subtype as string | null }))
    .sort((a, b) => Number(b.is_bank) - Number(a.is_bank) || (a.code as string).localeCompare(b.code as string, undefined, { numeric: true }));

  const head = (
    <header className="rise">
      <h1 className="text-3xl font-semibold tracking-tight">Reconcile</h1>
      <p className="mt-1 max-w-2xl text-muted">
        Match your books to a bank or card statement. Tick the transactions that appear on the statement until the difference is zero.
      </p>
    </header>
  );
  if (cash.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {head}
        <Card className="p-8 text-center text-muted">
          No bank accounts or credit cards yet. Add one on the{" "}
          <Link href="/categories" className="font-medium text-brand-700 underline underline-offset-2">
            Categories
          </Link>{" "}
          page.
        </Card>
      </div>
    );
  }

  const account = cash.find((a) => a.id === one(sp.account)) ?? cash[0];
  const multi = (entities?.length ?? 0) > 1;
  const labelOf = (a: (typeof cash)[number]) => `${a.name}${a.last4 ? ` ••${a.last4}` : ""}${multi ? ` (${entityName.get(a.entity_id as string) ?? ""})` : ""}`;
  const isCard = !account.is_bank;
  const debitNormal = account.type === "asset" && account.subtype !== "contra_asset";

  // The next statement is most likely the month after what is already reconciled, so start at the month of the oldest unreconciled transaction.
  const { data: oldest } = await supabase.rpc("unreconciled_lines", { p_account_id: account.id, p_through: "9999-12-31" }).range(0, 0);
  const oldestDate = ((oldest ?? []) as LineRow[])[0]?.entry_date;
  const on = isDate(one(sp.on)) ? one(sp.on) : oldestDate ? monthEnd(oldestDate) : new Date().toISOString().slice(0, 10);

  const lines: LineRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc("unreconciled_lines", { p_account_id: account.id, p_through: on }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    lines.push(...((data ?? []) as LineRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const [{ data: beginning }, { data: history }] = await Promise.all([
    supabase.rpc("reconciled_balance", { p_account_id: account.id }),
    supabase
      .from("reconciliations")
      .select("id, period_end, statement_ending_balance_cents")
      .eq("account_id", account.id)
      .not("reconciled_at", "is", null)
      .order("period_end", { ascending: false })
      .limit(12),
  ]);
  const rows: ReconcileRow[] = lines.map((l) => {
    const d = Number(l.debit_cents);
    const c = Number(l.credit_cents);
    return {
      id: l.line_id,
      date: l.entry_date,
      memo: l.memo ?? "",
      other: l.other_accounts ?? "",
      property: l.property_id ? (propertyName.get(l.property_id) ?? "") : "",
      increaseCents: debitNormal ? d : c,
      decreaseCents: debitNormal ? c : d,
    };
  });
  const past = history ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {head}

      {isDate(one(sp.done)) && (
        <p role="status" className="rise flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          Reconciled through {day(one(sp.done))}. The next statement is ready below.
        </p>
      )}

      <div className="rise">
        <ReconcileControls accounts={cash.map((a) => ({ id: a.id as string, label: labelOf(a) }))} accountId={account.id as string} date={on} />
      </div>

      <div className="rise">
        <ReconcileForm
          key={`${account.id}|${on}`}
          accountId={account.id as string}
          periodEnd={on}
          rows={rows}
          beginningCents={Number(beginning ?? 0)}
          isCard={isCard}
          lastReconciled={past[0]?.period_end ?? null}
        />
      </div>

      <section aria-labelledby="h-history" className="rise">
        <h2 id="h-history" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Past reconciliations <span className="ml-2 font-normal normal-case tracking-normal text-subtle">{labelOf(account)}</span>
        </h2>
        <Card className="overflow-hidden">
          {past.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">Nothing reconciled for this account yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th scope="col" className="px-5 py-2.5">Statement date</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Ending balance</th>
                  <th scope="col" className="px-5 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody>
                {past.map((h, i) => (
                  <tr key={h.id} className="border-t border-border/70">
                    <td className="px-5 py-2.5">{day(h.period_end as string)}</td>
                    <td className="num px-3 py-2.5 text-right">{formatAmount(Number(h.statement_ending_balance_cents), true)}</td>
                    <td className="px-5 py-2.5 text-right">{i === 0 ? <UndoReconciliation id={h.id as string} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}
