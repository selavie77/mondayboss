"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { formatAmount } from "@/lib/money";
import { reconcileSummary } from "@/lib/reconcile";
import { finishReconciliation, undoReconciliation } from "./actions";

export interface ReconcileRow {
  id: string;
  date: string;
  memo: string;
  other: string;
  property: string;
  increaseCents: number;
  decreaseCents: number;
}

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const money = (c: number) => formatAmount(c, true);
const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ReconcileControls({
  accounts,
  accountId,
  date,
}: {
  accounts: { id: string; label: string }[];
  accountId: string;
  date: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (patch: { account?: string; on?: string }) =>
    start(() => router.replace(`/reconcile?${new URLSearchParams({ account: accountId, on: date, ...patch }).toString()}`, { scroll: false }));
  return (
    <section aria-label="Statement" aria-busy={pending} className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="w-full sm:w-80">
        <label className={label} htmlFor="rc-account">
          Account
        </label>
        <Select compact id="rc-account" value={accountId} onChange={(e) => go({ account: e.target.value, on: "" })}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className={label} htmlFor="rc-date">
          Statement date
        </label>
        <Input compact id="rc-date" type="date" className="w-[9.5rem]" value={date} onChange={(e) => e.target.value && go({ on: e.target.value })} />
      </div>
    </section>
  );
}

export function ReconcileForm({
  accountId,
  periodEnd,
  rows,
  beginningCents,
  isCard,
  lastReconciled,
}: {
  accountId: string;
  periodEnd: string;
  rows: ReconcileRow[];
  beginningCents: number;
  isCard: boolean;
  lastReconciled: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [statement, setStatement] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();

  const statementCents = useMemo(() => {
    const t = statement.replace(/[$,\s]/g, "");
    if (t === "" || t === "-" || t === ".") return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }, [statement]);

  const summary = reconcileSummary({
    beginningCents,
    lines: rows.map((r) => ({ id: r.id, increaseCents: r.increaseCents, decreaseCents: r.decreaseCents })),
    selected,
    statementCents: statementCents ?? 0,
  });
  const balanced = statementCents !== null && summary.differenceCents === 0 && selected.size > 0;
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.memo} ${r.other} ${r.property}`.toLowerCase().includes(q)) : rows;
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setShown = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });

  const finish = () =>
    start(async () => {
      setError(undefined);
      const r = await finishReconciliation({ accountId, periodEnd, statement, lineIds: [...selected] });
      if (r.error) setError(r.error);
      // Back to the page for the next statement, with a note about what was just reconciled.
      else router.replace(`/reconcile?${new URLSearchParams({ account: accountId, done: periodEnd }).toString()}`);
    });

  const inc = isCard ? "Charges" : "Deposits";
  const dec = isCard ? "Payments" : "Payments";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label className={label} htmlFor="rc-balance">
              {isCard ? "Statement balance owed" : "Statement ending balance"}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-muted" aria-hidden>
                $
              </span>
              <Input compact id="rc-balance" inputMode="decimal" placeholder="0.00" className="w-40 text-right" value={statement} onChange={(e) => setStatement(e.target.value)} />
            </div>
          </div>
          <dl className="flex flex-1 flex-wrap items-end gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Beginning</dt>
              <dd className="num font-medium">{money(beginningCents)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                + {inc} ({summary.increaseCount})
              </dt>
              <dd className="num font-medium">{money(summary.increaseCents)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                − {dec} ({summary.decreaseCount})
              </dt>
              <dd className="num font-medium">{money(summary.decreaseCents)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cleared balance</dt>
              <dd className="num font-medium">{money(summary.clearedCents)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Difference</dt>
              <dd className={`num text-lg font-semibold ${statementCents === null ? "text-subtle" : summary.differenceCents === 0 ? "text-brand-700" : "text-warning-fg"}`}>
                {statementCents === null ? "–" : summary.differenceCents === 0 ? "0.00" : money(summary.differenceCents)}
              </dd>
            </div>
          </dl>
          <Button disabled={!balanced || pending} onClick={finish}>
            {pending ? "Saving…" : "Finish reconciliation"}
          </Button>
        </div>
        {error && (
          <div className="mt-2">
            <Notice>{error}</Notice>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-subtle" aria-hidden />
          <Input compact aria-label="Search these transactions" placeholder="Search" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <p className="text-muted">
          {selected.size.toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")} ticked. Untick anything that is not on your statement.
          {lastReconciled ? ` Reconciled through ${day(lastReconciled)} so far.` : ""}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-medium">Nothing left to reconcile through {day(periodEnd)}</p>
          <p className="mt-1 text-sm text-muted">Choose a later statement date, or import more transactions.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th scope="col" className="w-10 border-b border-border-strong px-4 py-2">
                  <input type="checkbox" aria-label="Tick all shown transactions" className="h-4 w-4 accent-[var(--brand-600)]" checked={allShownSelected} onChange={(e) => setShown(e.target.checked)} />
                </th>
                <th scope="col" className="w-28 border-b border-border-strong px-3 py-2">Date</th>
                <th scope="col" className="border-b border-border-strong px-3 py-2">Description</th>
                <th scope="col" className="w-32 border-b border-border-strong px-3 py-2 text-right">{inc}</th>
                <th scope="col" className="w-32 border-b border-border-strong px-4 py-2 text-right">{dec}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? "" : "bg-warning-bg/40"}>
                  <td className="border-b border-border/60 px-4 py-2">
                    <input type="checkbox" aria-label={`Tick ${r.memo || "transaction"} on ${r.date}`} className="h-4 w-4 accent-[var(--brand-600)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="num whitespace-nowrap border-b border-border/60 px-3 py-2 text-muted">{day(r.date)}</td>
                  <td className="border-b border-border/60 px-3 py-2">
                    <span className="font-medium">{r.memo || "(no description)"}</span>
                    <span className="block text-[12px] text-muted">{[r.other, r.property].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="num border-b border-border/60 px-3 py-2 text-right">{r.increaseCents ? money(r.increaseCents) : ""}</td>
                  <td className="num border-b border-border/60 px-4 py-2 text-right">{r.decreaseCents ? money(r.decreaseCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Undo the latest reconciliation. */
export function UndoReconciliation({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className="text-[13px] font-medium text-brand-700 hover:underline disabled:opacity-60"
        onClick={() => {
          if (!window.confirm("Undo this reconciliation? Its transactions go back to unreconciled so you can do it again.")) return;
          setError(undefined);
          start(async () => {
            const r = await undoReconciliation(id);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      {error && <span className="text-[12px] text-warning-fg">{error}</span>}
    </span>
  );
}
