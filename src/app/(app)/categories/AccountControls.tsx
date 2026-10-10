"use client";

import { useActionState, useState, useTransition } from "react";
import { Landmark, CreditCard, Undo2 } from "lucide-react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { createCashAccount, reverseOpeningBalance, setOpeningBalance, updateAccountScope, type AccountResult } from "./actions";

export interface ScopeOptions {
  portfolios: { id: string; name: string }[];
  properties: { id: string; name: string }[];
}

const longDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function ScopeOptionsList({ options }: { options: ScopeOptions }) {
  return (
    <>
      <option value="all">All properties (default account)</option>
      {options.portfolios.length > 0 && (
        <optgroup label="A portfolio">
          {options.portfolios.map((p) => (
            <option key={p.id} value={`pf:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {options.properties.length > 0 && (
        <optgroup label="A property">
          {options.properties.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/** Which property or portfolio a bank account or card is used for. Changing it saves right away. */
export function ScopeSelect({ accountId, value, options }: { accountId: string; value: string; options: ScopeOptions }) {
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div>
      <Select
        compact
        aria-label="Used for"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = current;
          setCurrent(next);
          setError(undefined);
          start(async () => {
            const r = await updateAccountScope(accountId, next);
            if (r.error) {
              setCurrent(previous);
              setError(r.error);
            }
          });
        }}
      >
        <ScopeOptionsList options={options} />
      </Select>
      {error && <p className="mt-1 text-xs text-negative">{error}</p>}
    </div>
  );
}

/** Shows an account's opening balance, or lets you set one. */
export function OpeningBalance({
  accountId,
  existing,
  defaultAsOf,
  amountLabel = "Balance",
}: {
  accountId: string;
  existing: { entryId: string; date: string; cents: number } | null;
  defaultAsOf: string;
  amountLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (existing) {
    return (
      <div className="text-sm">
        <span className="text-muted">Opening balance </span>
        <span className="num font-medium">{formatCents(existing.cents)}</span>
        <span className="text-muted"> as of {longDate(existing.date)}</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Reverse this opening balance? It will be removed from your books so you can enter it again. The reversal stays in your history.")) return;
            start(async () => {
              const r = await reverseOpeningBalance(existing.entryId);
              setError(r.error);
            });
          }}
          className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          <Undo2 className="h-3 w-3" aria-hidden /> Reverse
        </button>
        {error && <p className="mt-1 text-xs text-negative">{error}</p>}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-brand-700 hover:underline">
        Set opening balance
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-background p-3">
      <div className="w-36">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{amountLabel}</label>
        <Input compact inputMode="decimal" aria-label={amountLabel} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </div>
      <div className="w-40">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">As of</label>
        <Input compact type="date" aria-label="As of date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={pending || !amount.trim() || !asOf}
        onClick={() =>
          start(async () => {
            const r = await setOpeningBalance({ accountId, asOf, amount });
            if (r.error) setError(r.error);
            else setOpen(false);
          })
        }
      >
        {pending ? "Posting…" : "Post"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && (
        <div className="w-full">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}

/** Create a bank account or credit card, tied to a property or portfolio, with an optional opening balance. */
export function AddCashAccount({ entityId, options, defaultAsOf }: { entityId: string; options: ScopeOptions; defaultAsOf: string }) {
  const [kind, setKind] = useState<"bank" | "credit_card" | null>(null);
  const [state, action, pending] = useActionState<AccountResult | undefined, FormData>(async (prev, formData) => {
    const r = await createCashAccount(prev, formData);
    if (r?.ok) setKind(null);
    return r;
  }, undefined);

  if (!kind) {
    return (
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button size="sm" variant="secondary" onClick={() => setKind("bank")}>
          <Landmark className="h-4 w-4" aria-hidden /> Add bank account
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setKind("credit_card")}>
          <CreditCard className="h-4 w-4" aria-hidden /> Add credit card
        </Button>
      </div>
    );
  }

  const isCard = kind === "credit_card";
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-border bg-background p-5">
      <h3 className="font-semibold">{isCard ? "Add a credit card" : "Add a bank account"}</h3>
      <input type="hidden" name="entity_id" value={entityId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint={isCard ? "For example, “Chase Ink”." : "For example, “126 E Orchard Springs checking”."}>
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Account number (last 4 digits)" hint="Optional. Helps you tell similar accounts apart.">
          <Input name="last4" inputMode="numeric" maxLength={4} placeholder="1234" />
        </Field>
        <Field label="Used for" hint="Transactions on this property or portfolio will default to this account. You can always choose another.">
          <Select name="scope" defaultValue="all">
            <ScopeOptionsList options={options} />
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isCard ? "Balance owed" : "Opening balance"} hint={isCard ? "What you owed on the as-of date." : "Optional. Enter a negative number for an overdraft."}>
            <Input name="opening" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="As of" hint="The day before your first transaction.">
            <Input name="as_of" type="date" defaultValue={defaultAsOf} />
          </Field>
        </div>
      </div>
      {state?.error && <Notice>{state.error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : isCard ? "Add credit card" : "Add bank account"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setKind(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
