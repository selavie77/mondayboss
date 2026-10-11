"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import type { CreatedAccount } from "@/app/(app)/create-actions";
import { CREATE_VALUE, CreateAccountDialog, CreateCategoryDialog } from "@/components/create-dialogs";
import { Modal } from "@/components/Modal";
import { Button, Input, Notice, Select } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { isCashLike, resolvePaidFrom } from "@/lib/paidFrom";
import { STEP_LABELS, TYPE_LABELS, type TransactionType } from "@/lib/transaction";
import { setOpeningBalance } from "./categories/actions";
import { addTransaction, loadTransactionForm, type FormAccount, type TransactionFormData } from "./transactions/actions";

type WizardType = TransactionType | "opening";

const TYPE_CHIPS: { type: WizardType; label: string }[] = [
  ...TYPE_LABELS.filter((t) => t.type === "expense" || t.type === "income").map((t) => ({ type: t.type, label: t.label })),
  { type: "transfer", label: "Transfer" },
  { type: "opening", label: "Opening balance" },
  { type: "other", label: "Other" },
];

// Offered first when a business has no history yet.
const DEFAULT_CODES: Record<"expense" | "income", string[]> = {
  expense: ["5090", "5120", "5040", "5060", "5110", "5100"],
  income: ["4000", "4010", "4100"],
};

const GROUPS: { type: FormAccount["type"]; label: string }[] = [
  { type: "expense", label: "Expenses" },
  { type: "income", label: "Income" },
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities" },
  { type: "equity", label: "Owner equity" },
];

const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd in the person's own time zone

const accountLabel = (a: FormAccount, all: FormAccount[]) => {
  const parent = a.parentId ? all.find((p) => p.id === a.parentId) : undefined;
  return `${a.name}${a.last4 ? ` ••${a.last4}` : ""}${parent ? ` (${parent.name})` : ""}`;
};

/** The button in the sidebar, and the dialog it opens. */
export function AddTransaction() {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);

  return (
    <>
      <Button
        block
        onClick={() => {
          setRound((r) => r + 1); // a fresh form, and fresh data, every time
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden /> Add transaction
      </Button>
      <TransactionDialog key={round} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TransactionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<TransactionFormData | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadTransactionForm()
      .then((d) => live && setData(d))
      .catch(() => live && setError("We couldn't load your accounts. Please try again."));
    return () => {
      live = false;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Add transaction" size="lg">
      {error ? <Notice>{error}</Notice> : !data ? <p className="py-8 text-center text-sm text-muted">Loading…</p> : <Wizard data={data} onClose={onClose} />}
    </Modal>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
        selected ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-border-strong bg-surface text-foreground hover:border-brand-400 hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}

/** Options for a "More…" dropdown, grouped by account type. */
function GroupedOptions({ accounts, all, order }: { accounts: FormAccount[]; all: FormAccount[]; order: FormAccount["type"][] }) {
  return (
    <>
      {order.map((t) => {
        const label = GROUPS.find((g) => g.type === t)!.label;
        const list = accounts.filter((a) => a.type === t);
        const ordered = list.filter((a) => !a.parentId).flatMap((p) => [p, ...list.filter((c) => c.parentId === p.id)]);
        const rows = ordered.length > 0 ? ordered : list;
        if (rows.length === 0) return null;
        return (
          <optgroup key={t} label={label}>
            {rows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.parentId ? `  ↳ ${a.name}` : `${a.code} · ${accountLabel(a, all)}`}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

type Creating =
  | { kind: "category"; target: "category" | "debit" | "credit" }
  | { kind: "account"; target: "account" | "from" | "to" | "debit" | "credit" | "opening" };

function Wizard({ data, onClose }: { data: TransactionFormData; onClose: () => void }) {
  const [entityId, setEntityId] = useState(data.entities[0]?.id ?? "");
  const [type, setType] = useState<WizardType>("expense");
  const [extras, setExtras] = useState<FormAccount[]>([]);
  const [creating, setCreating] = useState<Creating | null>(null);

  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState(""); // paid from / deposited into (empty = the default)
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [openingAccount, setOpeningAccount] = useState("");

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ description: string; amountCents: number } | null>(null);
  const [pending, start] = useTransition();

  const accounts = [...data.accounts, ...extras.filter((e) => !data.accounts.some((a) => a.id === e.id))];
  const mine = accounts.filter((a) => a.entityId === entityId);
  const cash = mine.filter(isCashLike);
  const properties = data.properties.filter((p) => p.entityId === entityId);
  const property = properties.find((p) => p.id === propertyId) ?? null;

  // The account used by default follows the property, until the person picks one.
  const defaultAccount = resolvePaidFrom(property, mine) ?? "";
  const accountId = account || defaultAccount;
  const fromId = from || defaultAccount;

  const categoryType = type === "income" ? "income" : "expense";
  const nonCash = mine.filter((a) => !isCashLike(a));

  const categoryChips = (() => {
    const ids = [...(data.common[entityId]?.[categoryType] ?? [])];
    for (const code of DEFAULT_CODES[categoryType]) {
      const a = mine.find((x) => x.code === code);
      if (a && !ids.includes(a.id)) ids.push(a.id);
    }
    const shown = ids.filter((id) => mine.some((a) => a.id === id)).slice(0, 6);
    if (category && !shown.includes(category)) shown.push(category);
    return shown.map((id) => mine.find((a) => a.id === id)!);
  })();

  const accountChips = (() => {
    const list = [...cash].sort((a, b) => Number(b.id === defaultAccount) - Number(a.id === defaultAccount));
    const picked = type === "transfer" ? [fromId, to] : [accountId];
    for (const id of picked) {
      const a = mine.find((x) => x.id === id);
      if (a && !list.some((x) => x.id === a.id)) list.push(a);
    }
    return list;
  })();

  const resetForEntity = (id: string) => {
    setEntityId(id);
    setPropertyId("");
    setCategory("");
    setAccount("");
    setFrom("");
    setTo("");
    setDebit("");
    setCredit("");
    setOpeningAccount("");
  };

  const addExtra = (c: CreatedAccount): FormAccount => {
    const a: FormAccount = {
      id: c.id,
      entityId: c.entityId,
      parentId: c.parentId,
      code: c.code,
      name: c.name,
      type: c.type,
      subtype: c.subtype,
      isBank: c.isBank,
      last4: c.last4,
      propertyId: null,
      portfolioId: null,
    };
    setExtras((prev) => [...prev, a]);
    return a;
  };

  const assign = (target: Creating["target"], id: string) => {
    if (target === "category") setCategory(id);
    else if (target === "account") setAccount(id);
    else if (target === "from") setFrom(id);
    else if (target === "to") setTo(id);
    else if (target === "debit") setDebit(id);
    else if (target === "credit") setCredit(id);
    else if (target === "opening") setOpeningAccount(id);
  };

  /** A "More…" dropdown: picking an account selects it; the last option creates one. */
  const more = (label: string, options: React.ReactNode, onPick: (id: string) => void, onCreate: () => void, createLabel: string) => (
    <Select
      compact
      aria-label={label}
      value=""
      className="w-44"
      onChange={(e) => (e.target.value === CREATE_VALUE ? onCreate() : onPick(e.target.value))}
    >
      <option value="">More…</option>
      {options}
      <option value={CREATE_VALUE}>{createLabel}</option>
    </Select>
  );

  const submit = () => {
    setError(undefined);
    start(async () => {
      if (type === "opening") {
        const r = await setOpeningBalance({ accountId: openingAccount, asOf: date, amount });
        if (r.error) setError(r.error);
        else setSaved({ description: `Opening balance: ${mine.find((a) => a.id === openingAccount)?.name ?? ""}`, amountCents: Math.round(Number(amount.replace(/[$,]/g, "")) * 100) });
        return;
      }
      const r = await addTransaction({
        entityId,
        type,
        date,
        amount,
        description,
        notes: notes || undefined,
        propertyId: propertyId || null,
        category: category || undefined,
        account: type === "expense" || type === "income" ? accountId || undefined : undefined,
        from: type === "transfer" ? fromId || undefined : undefined,
        to: type === "transfer" ? to || undefined : undefined,
        debit: type === "other" ? debit || undefined : undefined,
        credit: type === "other" ? credit || undefined : undefined,
      });
      if ("error" in r) setError(r.error);
      else setSaved({ description: r.description, amountCents: r.amountCents });
    });
  };

  if (data.entities.length === 0) {
    return <Notice tone="info">Add a business first (Get started), then you can add transactions.</Notice>;
  }

  if (saved) {
    return (
      <div className="space-y-5 py-2">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">Added</p>
            <p className="text-sm text-muted">
              {saved.description} · <span className="num font-medium text-foreground">{formatCents(saved.amountCents)}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setSaved(null);
              setAmount("");
              setDescription("");
              setNotes("");
            }}
          >
            Add another
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const isMoney = type === "expense" || type === "income";
  const labels = type === "opening" ? null : STEP_LABELS[type];

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {data.entities.length > 1 && (
        <Step title="Which business?">
          <div role="group" aria-label="Business" className="flex flex-wrap gap-2">
            {data.entities.map((en) => (
              <Chip key={en.id} selected={entityId === en.id} onClick={() => resetForEntity(en.id)}>
                {en.name}
              </Chip>
            ))}
          </div>
        </Step>
      )}

      <Step title="What type of transaction?">
        <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
          {TYPE_CHIPS.map((t) => (
            <Chip
              key={t.type}
              selected={type === t.type}
              onClick={() => {
                setType(t.type);
                setCategory("");
                setError(undefined);
              }}
            >
              {t.label}
            </Chip>
          ))}
        </div>
      </Step>

      {isMoney && labels && (
        <>
          <Step title={labels.first}>
            <div className="flex flex-wrap items-center gap-2">
              {categoryChips.map((a) => (
                <Chip key={a.id} selected={category === a.id} onClick={() => setCategory(a.id)}>
                  {a.name}
                </Chip>
              ))}
              {more(
                "More categories",
                <GroupedOptions accounts={nonCash} all={mine} order={categoryType === "income" ? ["income", "expense", "asset", "liability", "equity"] : ["expense", "income", "asset", "liability", "equity"]} />,
                setCategory,
                () => setCreating({ kind: "category", target: "category" }),
                "＋ Create new category…",
              )}
            </div>
          </Step>
          <Step title={labels.second}>
            <div className="flex flex-wrap items-center gap-2">
              {accountChips.map((a) => (
                <Chip key={a.id} selected={accountId === a.id} onClick={() => setAccount(a.id)}>
                  {accountLabel(a, mine)}
                </Chip>
              ))}
              {more(
                "More accounts",
                <GroupedOptions accounts={cash.filter((a) => !accountChips.some((c) => c.id === a.id))} all={mine} order={["asset", "liability"]} />,
                setAccount,
                () => setCreating({ kind: "account", target: "account" }),
                "＋ Create new account…",
              )}
            </div>
          </Step>
        </>
      )}

      {type === "transfer" && labels && (
        <>
          <Step title={labels.first}>
            <div className="flex flex-wrap items-center gap-2">
              {accountChips.map((a) => (
                <Chip key={a.id} selected={fromId === a.id} onClick={() => setFrom(a.id)}>
                  {accountLabel(a, mine)}
                </Chip>
              ))}
              {more("More accounts to move from", <GroupedOptions accounts={mine.filter((a) => a.type === "asset" || a.type === "liability")} all={mine} order={["asset", "liability"]} />, setFrom, () => setCreating({ kind: "account", target: "from" }), "＋ Create new account…")}
            </div>
          </Step>
          <Step title={labels.second}>
            <div className="flex flex-wrap items-center gap-2">
              {accountChips
                .filter((a) => a.id !== fromId)
                .map((a) => (
                  <Chip key={a.id} selected={to === a.id} onClick={() => setTo(a.id)}>
                    {accountLabel(a, mine)}
                  </Chip>
                ))}
              {more("More accounts to move to", <GroupedOptions accounts={mine.filter((a) => (a.type === "asset" || a.type === "liability") && a.id !== fromId)} all={mine} order={["asset", "liability"]} />, setTo, () => setCreating({ kind: "account", target: "to" }), "＋ Create new account…")}
            </div>
            <p className="mt-2 text-[13px] text-muted">For a credit card payment, move money from your bank to the card. A mortgage payment can go to the mortgage.</p>
          </Step>
        </>
      )}

      {type === "other" && labels && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Step title={labels.first}>
            <Select aria-label="Debit account" value={debit} onChange={(e) => (e.target.value === CREATE_VALUE ? setCreating({ kind: "category", target: "debit" }) : setDebit(e.target.value))}>
              <option value="">Choose an account…</option>
              <GroupedOptions accounts={mine} all={mine} order={["expense", "asset", "liability", "income", "equity"]} />
              <option value={CREATE_VALUE}>＋ Create new category…</option>
            </Select>
          </Step>
          <Step title={labels.second}>
            <Select aria-label="Credit account" value={credit} onChange={(e) => (e.target.value === CREATE_VALUE ? setCreating({ kind: "category", target: "credit" }) : setCredit(e.target.value))}>
              <option value="">Choose an account…</option>
              <GroupedOptions accounts={mine} all={mine} order={["income", "liability", "asset", "equity", "expense"]} />
              <option value={CREATE_VALUE}>＋ Create new category…</option>
            </Select>
          </Step>
        </div>
      )}

      {type === "opening" && (
        <Step title="Which account?">
          <Select
            aria-label="Account"
            value={openingAccount}
            onChange={(e) => (e.target.value === CREATE_VALUE ? setCreating({ kind: "account", target: "opening" }) : setOpeningAccount(e.target.value))}
          >
            <option value="">Choose an account…</option>
            <GroupedOptions accounts={mine.filter((a) => a.type === "asset" || a.type === "liability")} all={mine} order={["asset", "liability"]} />
            <option value={CREATE_VALUE}>＋ Create new bank account or credit card…</option>
          </Select>
          <p className="mt-2 text-[13px] text-muted">Enter what the account held (or what you owed) on the day your books begin. Use a negative number for an overdraft.</p>
        </Step>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tx-amount" className="mb-1.5 block text-sm font-semibold">
            {type === "opening" ? "Balance" : "Amount"}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
            <Input id="tx-amount" inputMode="decimal" placeholder="0.00" className="pl-7 num" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
        </div>
        <div>
          <label htmlFor="tx-date" className="mb-1.5 block text-sm font-semibold">
            {type === "opening" ? "As of" : "Date"}
          </label>
          <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>

      {type !== "opening" && (
        <div>
          <label htmlFor="tx-name" className="mb-1.5 block text-sm font-semibold">
            Name
          </label>
          <Input id="tx-name" placeholder="Who or what was it? For example, Home Depot: faucet" value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
      )}

      {type !== "opening" && properties.length > 0 && (
        <div className="sm:max-w-sm">
          <label htmlFor="tx-property" className="mb-1.5 block text-sm font-semibold">
            Property <span className="font-normal text-muted">(optional)</span>
          </label>
          <Select id="tx-property" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">No property</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {type !== "opening" && (
        <details className="group rounded-xl border border-border">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-muted group-open:text-foreground">Advanced</summary>
          <div className="border-t border-border p-4">
            <label htmlFor="tx-notes" className="mb-1.5 block text-sm font-medium">
              Notes
            </label>
            <textarea
              id="tx-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </div>
        </details>
      )}

      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save transaction"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <CreateCategoryDialog
        open={creating?.kind === "category"}
        onClose={() => setCreating(null)}
        entityId={entityId}
        defaultType={type === "income" ? "income" : "expense"}
        candidates={mine.filter((a) => !a.parentId && !isCashLike(a)).map((a) => ({ id: a.id, name: a.name, type: a.type }))}
        onCreated={(c) => {
          const a = addExtra(c);
          if (creating) assign(creating.target, a.id);
          setCreating(null);
        }}
      />
      <CreateAccountDialog
        open={creating?.kind === "account"}
        onClose={() => setCreating(null)}
        entities={data.entities.filter((e) => e.id === entityId)}
        defaultEntityId={entityId}
        onCreated={(c) => {
          const a = addExtra(c);
          if (creating) assign(creating.target, a.id);
          setCreating(null);
        }}
      />
    </form>
  );
}
