"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import { formatAmount, toCents } from "@/lib/money";
import { computeSale, type SaleFacts } from "@/lib/propertySale";
import { recordPropertySale, undoPropertySale, type SaleResult } from "./actions";

export interface SaleFormProps {
  propertyId: string;
  propertyName: string;
  date: string;
  facts: SaleFacts;
  /** Names for the accounts the entry can touch, for the preview. */
  names: Record<string, string>;
  bankAccounts: { id: string; name: string; isProperty: boolean }[];
  /** Account ids for the preview. The server looks them up again when it records the sale. */
  ids: { recordedProceeds: string; loan: string | null; deposits: string | null; escrow: string | null; gain: string };
}

const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const dollars = (c: number) => (c / 100).toFixed(2);
const money = (c: number) => formatAmount(c, true);

function Amount({ id, text, onChange, children, hint }: { id: string; text: string; onChange: (v: string) => void; children: string; hint?: string }) {
  return (
    <div>
      <label className={label} htmlFor={id}>
        {children}
      </label>
      <div className="flex items-center gap-1">
        <span className="text-muted" aria-hidden>
          $
        </span>
        <Input compact id={id} inputMode="decimal" placeholder="0.00" className="text-right" value={text} onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function parse(text: string): number {
  try {
    return text.trim() === "" ? 0 : toCents(text);
  } catch {
    return 0;
  }
}

export function SaleForm({ propertyId, propertyName, date, facts, names, bankAccounts, ids }: SaleFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [price, setPrice] = useState("");
  const [costs, setCosts] = useState("");
  const [payoff, setPayoff] = useState(facts.loanCents > 0 ? dollars(facts.loanCents) : "");
  const [deposits, setDeposits] = useState(facts.depositsCents > 0 ? dollars(facts.depositsCents) : "");
  const [escrow, setEscrow] = useState(facts.escrowCents > 0 ? dollars(facts.escrowCents) : "");
  const [proceeds, setProceeds] = useState(facts.recordedProceedsCents > 0 ? "recorded" : (bankAccounts.find((b) => b.isProperty) ?? bankAccounts[0])?.id ?? "");
  const [result, setResult] = useState<SaleResult | null>(null);

  const toAccount = proceeds === "recorded" ? ids.recordedProceeds : proceeds;
  const calc = computeSale(
    facts,
    { priceCents: parse(price), costsCents: parse(costs), payoffCents: parse(payoff), depositsCents: parse(deposits), escrowCents: parse(escrow) },
    { proceeds: toAccount, loan: ids.loan ?? "loan", deposits: ids.deposits ?? "deposits", escrow: ids.escrow ?? "escrow", accumDepr: facts.accumDeprAccountId, gain: ids.gain },
  );
  const nameOf = (id: string) => names[id] ?? (id === ids.recordedProceeds ? "Transfers › Sale Proceeds" : id === ids.gain ? "Gain (Loss) on Sale of Property" : id);
  const priced = parse(price) > 0;
  const mismatch = proceeds === "recorded" && priced && calc.netProceedsCents !== facts.recordedProceedsCents;

  if (result?.ok) {
    const { gainCents, netCents } = result.ok;
    return (
      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">Sale recorded</p>
            <p className="text-sm text-muted">
              {propertyName} sold {date}. Net proceeds {money(netCents)}; {gainCents >= 0 ? "gain" : "loss"} of {money(Math.abs(gainCents))}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/transactions" className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 font-medium text-white hover:bg-brand-700">
            View the transaction
          </Link>
          <Link href="/properties" className="inline-flex h-11 items-center rounded-xl border border-border-strong bg-surface px-5 font-medium hover:bg-brand-50">
            Back to properties
          </Link>
        </div>
      </Card>
    );
  }

  const submit = () =>
    start(async () => {
      const r = await recordPropertySale({ propertyId, date, price, costs, payoff, deposits, escrow, proceeds });
      setResult(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-5">
      <Card className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Amount id="sale-price" text={price} onChange={setPrice}>
            Sale price
          </Amount>
          <Amount id="sale-costs" text={costs} onChange={setCosts} hint="Agent commissions, closing costs and anything else you paid out of the sale.">
            Selling costs
          </Amount>
          <Amount id="sale-payoff" text={payoff} onChange={setPayoff} hint={facts.loanCents > 0 ? `Loan balance in your books: ${money(facts.loanCents)}. Enter 0 if you paid it off from your bank separately.` : "No loan balance is recorded for this property."}>
            Loan paid off at closing
          </Amount>
          <Amount id="sale-deposits" text={deposits} onChange={setDeposits} hint="Tenant deposits you handed to the buyer.">
            Security deposits transferred
          </Amount>
          <Amount id="sale-escrow" text={escrow} onChange={setEscrow} hint="Escrow the lender refunded to you.">
            Escrow refunded
          </Amount>
          <div>
            <label className={label} htmlFor="sale-to">
              Where did the net proceeds go?
            </label>
            <Select compact id="sale-to" value={proceeds} onChange={(e) => setProceeds(e.target.value)}>
              {facts.recordedProceedsCents > 0 && <option value="recorded">Already in my books as Sale Proceeds ({money(facts.recordedProceedsCents)})</option>}
              {facts.recordedProceedsCents <= 0 && <option value="recorded">A Sale Proceeds deposit I&apos;ll import</option>}
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">What this does to your books</h2>
          <p className="text-sm text-muted">One entry dated {date}. The gain is what you received after selling costs, minus what the property cost you less depreciation.</p>
        </div>

        {calc.warnings.map((w) => (
          <p key={w} role="status" className="flex items-start gap-2 rounded-xl bg-warning-bg px-3.5 py-2.5 text-sm text-warning-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {w}
          </p>
        ))}
        {mismatch && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-bg px-3.5 py-2.5 text-sm text-warning-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> The net proceeds here ({money(calc.netProceedsCents)}) differ from the Sale Proceeds already in your books ({money(facts.recordedProceedsCents)}). Check the amounts above, or the difference stays in Sale Proceeds.
          </p>
        )}

        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            ["Net proceeds", calc.netProceedsCents],
            ["Cost in your books", calc.costBasisCents],
            ["Depreciation taken", calc.accumDeprCents],
            [calc.gainCents < 0 ? "Loss on sale" : "Gain on sale", calc.gainCents],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-border bg-background px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="num mt-0.5 text-lg font-semibold">{priced ? money(v as number) : "–"}</dd>
            </div>
          ))}
        </dl>

        {priced && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th scope="col" className="px-4 py-2">Account</th>
                  <th scope="col" className="px-4 py-2 text-right">Debit</th>
                  <th scope="col" className="px-4 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {calc.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/70">
                    <td className={`px-4 py-2 ${l.creditCents > 0 ? "pl-8" : ""}`}>
                      {nameOf(l.accountId)}
                      <span className="block text-[12px] text-muted">{l.label}</span>
                    </td>
                    <td className="num px-4 py-2 text-right">{l.debitCents ? money(l.debitCents) : ""}</td>
                    <td className="num px-4 py-2 text-right">{l.creditCents ? money(l.creditCents) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result?.error && <Notice>{result.error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || !priced || calc.problems.length > 0} onClick={submit}>
            {pending ? "Recording…" : "Record sale"}
          </Button>
          {priced && calc.problems.length > 0 && <p className="text-sm text-muted">{calc.problems[0]}</p>}
        </div>
      </Card>
    </div>
  );
}

/** Shown for a property whose sale is already recorded. */
export function UndoSale({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Undo this sale? The sale entry is reversed, and the property is marked as owned again. Both stay in your history.")) return;
          setError(undefined);
          start(async () => {
            const r = await undoPropertySale(propertyId);
            if (r.error) setError(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? "Undoing…" : "Undo this sale"}
      </Button>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

/** The sale date. Changing it reloads the page, because the balances in the books depend on the date. */
export function SaleDate({ propertyId, date }: { propertyId: string; date: string }) {
  const router = useRouter();
  return (
    <div>
      <label className={label} htmlFor="sale-date">
        Sale date
      </label>
      <Input compact id="sale-date" type="date" className="w-[9.5rem]" value={date} onChange={(e) => e.target.value && router.replace(`/properties/${propertyId}/sale?date=${e.target.value}`, { scroll: false })} />
    </div>
  );
}
