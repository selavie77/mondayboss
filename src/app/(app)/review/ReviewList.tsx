"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Check, Plus, Scissors, Tag, X } from "lucide-react";
import { Button, Card, Input, Notice, Select } from "@/components/ui";
import { formatCents, toCents } from "@/lib/money";
import { acceptLines, ignoreLine, postLine, type ReviewResult } from "./actions";

export interface AccountOption {
  id: string;
  entityId: string;
  parentId: string | null;
  subtype: string | null;
  last4: string | null;
  code: string;
  name: string;
  type: string;
  isBank: boolean;
}

export interface ReviewItem {
  id: string;
  entityId: string;
  paidFromId: string | null;
  propertyId: string | null;
  date: string;
  description: string;
  amountCents: number;
  property: string;
  source: string;
  reason: string;
  proposalDebit: string | null;
  proposalCredit: string | null;
  hasProposal: boolean;
  isMortgage: boolean;
}

const explain: { match: RegExp; text: string }[] = [
  { match: /escrow/i, text: "Money held by your lender for taxes and insurance. These look right, but they change your tax deduction, so confirm them." },
  { match: /refund/i, text: "An expense that came in as money back. Usually a refund or a manager credit; accept it to reduce that expense." },
  { match: /negative income/i, text: "Income that went out instead of in, such as a returned payment or a reversal." },
  { match: /split/i, text: "One payment that covers several things. Split it into principal, interest and escrow." },
  { match: /transfer/i, text: "A transfer with no clear purpose. Tell us what it was." },
];
const explainFor = (reason: string) => explain.find((e) => e.match.test(reason))?.text;

const typeOrder = ["income", "expense", "liability", "equity", "asset"];
const typeLabel: Record<string, string> = {
  income: "Income",
  expense: "Expenses",
  liability: "Liabilities",
  equity: "Owner equity",
  asset: "Assets",
};

export interface PropertyOption {
  id: string;
  name: string;
  entityId: string;
}

interface TransferOption {
  id: string;
  label: string;
}

function AccountSelect({
  accounts,
  value,
  onChange,
  label,
  transfers = [],
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Other bank accounts and cards, for moving money between your own accounts (a card payment, for example). */
  transfers?: TransferOption[];
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} compact>
      <option value="">Choose an account…</option>
      {typeOrder.map((t) => {
        const group = accounts.filter((a) => a.type === t && !a.isBank && a.subtype !== "credit_card");
        if (group.length === 0) return null;
        // Categories, each followed by its subcategories (indented).
        const ordered = group
          .filter((a) => !a.parentId)
          .flatMap((p) => [p, ...group.filter((c) => c.parentId === p.id)]);
        return (
          <optgroup key={t} label={typeLabel[t]}>
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.parentId ? `    ↳ ${a.name}` : `${a.code} · ${a.name}`}
              </option>
            ))}
          </optgroup>
        );
      })}
      {transfers.length > 0 && (
        <optgroup label="Transfer to or from another account">
          {transfers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

export function ReviewList({ items, accounts, properties }: { items: ReviewItem[]; accounts: AccountOption[]; properties: PropertyOption[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, ReviewItem[]>();
    for (const it of items) {
      const main = it.reason.split("; ")[0];
      m.set(main, [...(m.get(main) ?? []), it]);
    }
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  return (
    <div className="space-y-6">
      {groups.map(([reason, rows], i) => (
        <Group key={reason} reason={reason} rows={rows} accounts={accounts} properties={properties} delay={i * 50} />
      ))}
    </div>
  );
}

function Group({
  reason,
  rows,
  accounts,
  properties,
  delay,
}: {
  reason: string;
  rows: ReviewItem[];
  accounts: AccountOption[];
  properties: PropertyOption[];
  delay: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const acceptable = rows.filter((r) => r.hasProposal);
  const help = explainFor(reason);

  return (
    <section className="rise" style={{ animationDelay: `${delay}ms` }} aria-label={reason}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-brand-50/50 px-5 py-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="font-semibold">
              {reason} <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">{rows.length}</span>
            </h2>
            {help && <p className="mt-1 text-sm text-muted">{help}</p>}
          </div>
          {acceptable.length > 1 && (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await acceptLines(acceptable.map((a) => a.id));
                  setError(r.error);
                })
              }
            >
              <Check className="h-4 w-4" aria-hidden />
              {pending ? "Posting…" : `Accept all ${acceptable.length}`}
            </Button>
          )}
        </div>
        {error && (
          <div className="px-5 pt-4">
            <Notice>{error}</Notice>
          </div>
        )}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <Row key={r.id} item={r} accounts={accounts.filter((a) => a.entityId === r.entityId)} properties={properties.filter((p) => p.entityId === r.entityId)} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

type Mode = "view" | "change" | "split";

function Row({ item, accounts, properties }: { item: ReviewItem; accounts: AccountOption[]; properties: PropertyOption[] }) {
  const [mode, setMode] = useState<Mode>("view");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  // Where the money came from: defaults to the property's account, and can be changed.
  const cash = accounts.filter((a) => a.isBank || a.subtype === "credit_card");
  const [paidFrom, setPaidFrom] = useState(item.paidFromId ?? cash[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState(item.propertyId ?? "");
  const transfers: TransferOption[] = cash
    .filter((a) => a.id !== paidFrom)
    .map((a) => ({ id: a.id, label: `${a.name}${a.last4 ? ` ••${a.last4}` : ""}${a.isBank ? "" : " (credit card)"}` }));

  const run = (fn: () => Promise<ReviewResult>) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
    });

  const abs = Math.abs(item.amountCents);
  const inflow = item.amountCents > 0;

  return (
    <li className="px-5 py-4">
      <div className="grid items-center gap-x-6 gap-y-3 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.description}</p>
          <p className="truncate text-[13px] text-muted">
            {new Date(item.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {item.property && <> · {item.property}</>}
            {item.source && <> · was “{item.source}”</>}
          </p>
          {item.reason.includes("; ") && (
            <p className="mt-1 text-[13px] text-warning-fg">Also: {item.reason.split("; ").slice(1).join("; ")}</p>
          )}
          {item.hasProposal && item.proposalDebit && item.proposalCredit ? (
            <p className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 text-[13px] text-brand-700">
              <Tag className="h-3.5 w-3.5" aria-hidden />
              <span>{item.proposalDebit}</span>
              <ArrowRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
              <span>{item.proposalCredit}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] font-medium text-warning-fg">Needs a category</p>
          )}
        </div>
        <p className={`num text-right text-lg font-semibold ${inflow ? "text-positive" : ""}`}>
          {inflow ? "+" : "−"}
          {formatCents(abs)}
        </p>
      </div>

      {mode === "view" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.hasProposal && (
            <Button size="sm" disabled={pending} onClick={() => run(() => acceptLines([item.id]))}>
              <Check className="h-4 w-4" aria-hidden /> Accept
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setMode("change")}>
            <Tag className="h-4 w-4" aria-hidden /> Change category
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setMode("split")}>
            <Scissors className="h-4 w-4" aria-hidden /> Split
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => ignoreLine(item.id))}>
            <X className="h-4 w-4" aria-hidden /> Ignore
          </Button>
        </div>
      )}

      {mode !== "view" && cash.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`paid-${item.id}`} className="text-muted">
            {inflow ? "Deposited into" : "Paid from"}
          </label>
          <div className="w-full sm:w-64">
            <Select compact id={`paid-${item.id}`} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
              {cash.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.last4 ? ` ••${a.last4}` : ""}
                  {!a.isBank ? " (credit card)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {properties.length > 0 && (
            <>
              <label htmlFor={`prop-${item.id}`} className="text-muted sm:ml-3">
                Property
              </label>
              <div className="w-full sm:w-64">
                <Select compact id={`prop-${item.id}`} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">No property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "change" && (
        <Change
          accounts={accounts}
          pending={pending}
          onCancel={() => setMode("view")}
          transfers={transfers}
          onPost={(accountId) => run(() => postLine(item.id, [{ accountId, cents: abs }], paidFrom || undefined, propertyId || undefined))}
        />
      )}

      {mode === "split" && (
        <Split
          accounts={accounts}
          totalCents={abs}
          pending={pending}
          mortgage={item.isMortgage}
          onCancel={() => setMode("view")}
          transfers={transfers}
          onPost={(parts) => run(() => postLine(item.id, parts, paidFrom || undefined, propertyId || undefined))}
        />
      )}

      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </li>
  );
}

function Change({
  accounts,
  transfers,
  pending,
  onCancel,
  onPost,
}: {
  accounts: AccountOption[];
  transfers: TransferOption[];
  pending: boolean;
  onCancel: () => void;
  onPost: (accountId: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-80">
        <AccountSelect accounts={accounts} transfers={transfers} value={accountId} onChange={setAccountId} label="Category" />
      </div>
      <Button size="sm" disabled={!accountId || pending} onClick={() => onPost(accountId)}>
        {pending ? "Posting…" : "Post to books"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

interface Part {
  key: number;
  accountId: string;
  amount: string;
}

function Split({
  accounts,
  transfers,
  totalCents,
  pending,
  mortgage,
  onCancel,
  onPost,
}: {
  accounts: AccountOption[];
  transfers: TransferOption[];
  totalCents: number;
  pending: boolean;
  mortgage: boolean;
  onCancel: () => void;
  onPost: (parts: { accountId: string; cents: number }[]) => void;
}) {
  const byCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? "";
  const [parts, setParts] = useState<Part[]>(() =>
    mortgage
      ? [
          { key: 1, accountId: byCode("2100"), amount: "" }, // principal
          { key: 2, accountId: byCode("5070"), amount: "" }, // interest
          { key: 3, accountId: byCode("1100"), amount: "" }, // escrow
        ]
      : [
          { key: 1, accountId: "", amount: "" },
          { key: 2, accountId: "", amount: "" },
        ],
  );

  const cents = (p: Part) => {
    try {
      return p.amount.trim() === "" ? 0 : toCents(p.amount);
    } catch {
      return NaN;
    }
  };
  const used = parts.reduce((s, p) => s + (Number.isNaN(cents(p)) ? 0 : cents(p)), 0);
  const remaining = totalCents - used;
  const valid =
    remaining === 0 && parts.every((p) => cents(p) === 0 || (!Number.isNaN(cents(p)) && p.accountId !== "")) && used > 0;

  const update = (key: number, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const nameFor = (code: string) => (mortgage ? { "2100": "Principal", "5070": "Interest", "1100": "Escrow" }[code] : undefined);

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <ul className="space-y-2.5">
        {parts.map((p) => {
          const code = accounts.find((a) => a.id === p.accountId)?.code ?? "";
          return (
            <li key={p.key} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem_2rem]">
              <div>
                {nameFor(code) && <span className="mb-1 block text-xs font-medium text-muted">{nameFor(code)}</span>}
                <AccountSelect accounts={accounts} transfers={transfers} value={p.accountId} onChange={(v) => update(p.key, { accountId: v })} label="Account" />
              </div>
              <Input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                value={p.amount}
                onChange={(e) => update(p.key, { amount: e.target.value })}
                compact className="text-right num"
              />
              {parts.length > 2 ? (
                <button
                  type="button"
                  aria-label="Remove line"
                  onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-50"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setParts((ps) => [...ps, { key: Math.max(...ps.map((x) => x.key)) + 1, accountId: "", amount: "" }])}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a line
        </button>
        <p className="num text-sm">
          <span className="text-muted">Left to assign: </span>
          <span className={`font-semibold ${remaining === 0 ? "text-positive" : remaining < 0 ? "text-negative" : ""}`}>
            {formatCents(remaining)}
          </span>
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          disabled={!valid || pending}
          onClick={() =>
            onPost(
              parts
                .filter((p) => cents(p) > 0)
                .map((p) => ({ accountId: p.accountId, cents: cents(p) })),
            )
          }
        >
          {pending ? "Posting…" : "Post split to books"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
