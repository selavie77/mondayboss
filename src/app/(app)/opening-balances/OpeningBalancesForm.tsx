"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { formatAmount, toCents } from "@/lib/money";
import { openingFromAmount, type OpeningMode } from "@/lib/openingBalance";
import { reverseOpeningBalance } from "../categories/actions";
import { saveOpeningBalances, type SaveOpeningResult } from "./actions";

export interface OpeningRow {
  key: string;
  accountId: string;
  scope: "account" | "property";
  propertyId: string | null;
  name: string;
  detail: string;
  group: "cash" | "loan" | "other";
  /** "Balance" for money you have, "Amount owed" for cards and loans. */
  amountLabel: string;
  /** How far imported activity has moved this balance through the statement date. */
  movementCents: number;
  existing: { entryId: string; date: string; cents: number } | null;
}

const groups: { key: OpeningRow["group"]; title: string; hint: string }[] = [
  { key: "cash", title: "Bank accounts and credit cards", hint: "Use the balance on your statement." },
  { key: "loan", title: "Loans", hint: "Use the principal balance on your lender's statement." },
  { key: "other", title: "Other assets and liabilities", hint: "Escrow, property cost, deposits held. Leave blank anything you don't track." },
];

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";

export function OpeningControls({ entityId, mode, asOf, statementDate, firstActivity }: { entityId: string; mode: OpeningMode; asOf: string; statementDate: string; firstActivity: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (patch: Partial<{ mode: OpeningMode; as_of: string; on: string }>) => {
    const q = new URLSearchParams({ entity: entityId, mode, as_of: asOf, on: statementDate, ...patch });
    start(() => router.replace(`/opening-balances?${q.toString()}`, { scroll: false }));
  };
  return (
    <section aria-label="Opening balance settings" aria-busy={pending} className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="w-full sm:w-80">
        <label className={label} htmlFor="ob-mode">
          I&apos;ll enter
        </label>
        <Select compact id="ob-mode" value={mode} onChange={(e) => go({ mode: e.target.value as OpeningMode })}>
          <option value="statement">The balance on a recent statement (we work out the opening)</option>
          <option value="opening">The opening balance itself</option>
        </Select>
      </div>
      {mode === "statement" && (
        <div>
          <label className={label} htmlFor="ob-on">
            Statement date
          </label>
          <Input compact id="ob-on" type="date" className="w-[9.5rem]" value={statementDate} onChange={(e) => e.target.value && go({ on: e.target.value })} />
        </div>
      )}
      <div>
        <label className={label} htmlFor="ob-asof">
          Opening date
        </label>
        <Input compact id="ob-asof" type="date" className="w-[9.5rem]" value={asOf} onChange={(e) => e.target.value && go({ as_of: e.target.value })} />
      </div>
      <p className="max-w-md text-[13px] text-muted">
        {mode === "statement"
          ? "Pick the date of your statements first, then type each balance. We subtract what your imported transactions have already added or taken away."
          : `This is what each account held at the start. It must be on or before ${firstActivity ?? "your first transaction"}.`}
      </p>
    </section>
  );
}

export function OpeningBalancesForm({ entityId, rows, mode, asOf, statementDate }: { entityId: string; rows: OpeningRow[]; mode: OpeningMode; asOf: string; statementDate: string }) {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SaveOpeningResult | null>(null);
  const [pending, start] = useTransition();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string>();

  const open = rows.filter((r) => !r.existing);
  const filled = open.filter((r) => (amounts[r.key] ?? "").trim() !== "");

  const opening = (r: OpeningRow): number | null => {
    const text = (amounts[r.key] ?? "").trim();
    if (!text) return null;
    try {
      return openingFromAmount(mode, toCents(text), r.movementCents);
    } catch {
      return null;
    }
  };

  const save = () =>
    start(async () => {
      const r = await saveOpeningBalances({
        entityId,
        mode,
        asOf,
        statementDate: mode === "statement" ? statementDate : undefined,
        items: filled.map((x) => ({ accountId: x.accountId, scope: x.scope, propertyId: x.propertyId, amount: amounts[x.key] })),
      });
      setResult(r);
      if (!r.error && r.problems.length === 0) {
        setAmounts({});
        router.refresh();
      }
    });

  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const list = rows.filter((r) => r.group === g.key);
        if (list.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="text-sm font-semibold uppercase tracking-wide text-muted">
              {g.title} <span className="ml-2 font-normal normal-case tracking-normal text-subtle">{g.hint}</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
              <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th scope="col" className="border-b border-border-strong px-4 py-2">Account</th>
                    {mode === "statement" && <th scope="col" className="w-36 border-b border-border-strong px-3 py-2 text-right">Activity so far</th>}
                    <th scope="col" className="w-44 border-b border-border-strong px-3 py-2 text-right">{mode === "statement" ? "Statement balance" : "Opening balance"}</th>
                    <th scope="col" className="w-36 border-b border-border-strong px-4 py-2 text-right">Opening balance</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const o = opening(r);
                    const id = `ob-${r.key}`;
                    return (
                      <tr key={r.key} className="align-middle">
                        <td className="border-b border-border/60 px-4 py-2.5">
                          <label htmlFor={id} className="font-medium">
                            {r.name}
                          </label>
                          {r.detail && <span className="block text-[12px] text-muted">{r.detail}</span>}
                        </td>
                        {mode === "statement" && <td className="num border-b border-border/60 px-3 py-2.5 text-right text-muted">{formatAmount(r.movementCents, true)}</td>}
                        {r.existing ? (
                          <>
                            <td className="border-b border-border/60 px-3 py-2.5 text-right text-[13px] text-muted">Already set</td>
                            <td className="border-b border-border/60 px-4 py-2.5 text-right">
                              <span className="num inline-flex items-center gap-1.5 font-medium">
                                <CheckCircle2 className="h-4 w-4 text-brand-600" aria-hidden /> {formatAmount(r.existing.cents, true)}
                              </span>
                              <button
                                type="button"
                                disabled={undoing === r.key}
                                onClick={() => {
                                  if (!window.confirm(`Reverse the opening balance for ${r.name}? It stays in your history, and you can enter it again.`)) return;
                                  setUndoing(r.key);
                                  setUndoError(undefined);
                                  setResult(null);
                                  void reverseOpeningBalance(r.existing!.entryId).then((res) => {
                                    setUndoing(null);
                                    if (res.error) setUndoError(res.error);
                                    else router.refresh();
                                  });
                                }}
                                className="mt-0.5 flex w-full items-center justify-end gap-1 text-[12px] font-medium text-brand-700 hover:underline"
                              >
                                <Undo2 className="h-3 w-3" aria-hidden /> Reverse
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="border-b border-border/60 px-3 py-2.5">
                              <div className="ml-auto flex w-40 items-center gap-1">
                                <span className="text-muted" aria-hidden>
                                  $
                                </span>
                                <Input compact id={id} inputMode="decimal" placeholder={r.amountLabel} className="text-right" value={amounts[r.key] ?? ""} onChange={(e) => setAmounts({ ...amounts, [r.key]: e.target.value })} />
                              </div>
                            </td>
                            <td className="num border-b border-border/60 px-4 py-2.5 text-right">
                              {o === null ? <span className="text-subtle">–</span> : o === 0 ? <span className="text-muted">Matches</span> : formatAmount(o, true)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {undoError && <Notice>{undoError}</Notice>}
      {result?.error && <Notice>{result.error}</Notice>}
      {result?.problems.map((p) => (
        <Notice key={p}>{p}</Notice>
      ))}
      {result && !result.error && result.problems.length === 0 && (
        <Notice tone="info">
          Saved {result.saved} opening {result.saved === 1 ? "balance" : "balances"}
          {result.matched > 0 ? `. ${result.matched} already matched, so nothing was needed.` : "."}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || filled.length === 0} onClick={save}>
          {pending ? "Saving…" : filled.length === 0 ? "Enter a balance to save" : `Save ${filled.length} opening ${filled.length === 1 ? "balance" : "balances"}`}
        </Button>
        {mode === "statement" && <p className="text-[13px] text-muted">Opening balances are dated {asOf}. Statement balances are as of {statementDate}.</p>}
      </div>
    </div>
  );
}
