"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import {
  createCashAccountQuick,
  createCategoryQuick,
  createPortfolio,
  type CreatedAccount,
} from "@/app/(app)/create-actions";

/** The value of the "Create new…" option at the bottom of a dropdown. */
export const CREATE_VALUE = "__create__";

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export function CreatePortfolioDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (portfolio: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <Modal open={open} onClose={onClose} title="Create a portfolio">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          start(async () => {
            const r = await createPortfolio(name);
            if ("created" in r) {
              setName("");
              onCreated(r.created);
            } else setError(r.error);
          });
        }}
      >
        <Field label="Portfolio name" hint="A way to group properties, such as a business or a strategy: “Ohio rentals”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create portfolio"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Category (or subcategory)
// ---------------------------------------------------------------------------

export interface ParentCandidate {
  id: string;
  name: string;
  type: string;
}

const TYPE_LABELS: [CreatedAccount["type"], string][] = [
  ["expense", "Expense"],
  ["income", "Income"],
  ["liability", "Liability (something you owe)"],
  ["asset", "Asset (something you own)"],
  ["equity", "Owner equity"],
];

export function CreateCategoryDialog({
  open,
  onClose,
  entityId,
  defaultType,
  candidates,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  entityId: string;
  defaultType: CreatedAccount["type"];
  /** Top-level categories that could be the parent of a new subcategory. */
  candidates: ParentCandidate[];
  onCreated: (account: CreatedAccount) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CreatedAccount["type"]>(defaultType);
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const parents = candidates.filter((c) => c.type === type);

  return (
    <Modal open={open} onClose={onClose} title="Create a category">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          start(async () => {
            const r = await createCategoryQuick({ entityId, name, type, parentId: parentId || null });
            if ("created" in r) {
              setName("");
              setParentId("");
              onCreated(r.created);
            } else setError(r.error);
          });
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as CreatedAccount["type"]);
                setParentId("");
              }}
            >
              {TYPE_LABELS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inside" hint="Pick a category to make this a subcategory of it.">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Nothing: a new category</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create category"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bank account or credit card
// ---------------------------------------------------------------------------

export function CreateAccountDialog({
  open,
  onClose,
  entities,
  defaultEntityId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  entities: { id: string; name: string }[];
  defaultEntityId?: string;
  onCreated: (account: CreatedAccount) => void;
}) {
  const [kind, setKind] = useState<"bank" | "credit_card">("bank");
  const [entityId, setEntityId] = useState(defaultEntityId ?? entities[0]?.id ?? "");
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <Modal open={open} onClose={onClose} title="Create a bank account or credit card">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          start(async () => {
            const r = await createCashAccountQuick({ entityId, kind, name, last4: last4 || undefined });
            if ("created" in r) {
              setName("");
              setLast4("");
              onCreated(r.created);
            } else setError(r.error);
          });
        }}
      >
        <div role="radiogroup" aria-label="Kind of account" className="grid grid-cols-2 gap-2">
          {(
            [
              ["bank", "Bank account"],
              ["credit_card", "Credit card"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                kind === value ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-100" : "border-border-strong bg-surface text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint={kind === "bank" ? "For example, “126 E Orchard Springs checking”." : "For example, “Chase Ink”."}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </Field>
          <Field label="Last 4 digits (optional)">
            <Input value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="1234" />
          </Field>
        </div>
        {entities.length > 1 && (
          <Field label="Belongs to">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <p className="text-[13px] text-muted">You can tie it to a property and enter an opening balance later, on the Categories page.</p>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !name.trim() || !entityId}>
            {pending ? "Creating…" : kind === "bank" ? "Create bank account" : "Create credit card"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
