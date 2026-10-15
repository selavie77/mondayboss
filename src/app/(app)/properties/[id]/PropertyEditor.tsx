"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Plus, X } from "lucide-react";
import { PortfolioSelect, type PortfolioOption } from "@/components/PortfolioSelect";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { bpToPercent, ownershipProblem, percentToBp } from "@/lib/ownership";
import { saveOwners, updateProperty } from "./actions";

export interface PropertyDetails {
  id: string;
  name: string;
  rentalType: string;
  portfolioId: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  acquiredOn: string;
  placedInServiceOn: string;
  purchasePrice: string;
}

export function PropertyDetailsForm({ property, portfolios }: { property: PropertyDetails; portfolios: PortfolioOption[] }) {
  const router = useRouter();
  const [v, setV] = useState(property);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PropertyDetails>) => {
    setV({ ...v, ...patch });
    setSaved(false);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(undefined);
          const r = await updateProperty({
            id: v.id,
            name: v.name,
            rentalType: v.rentalType,
            portfolioId: v.portfolioId,
            address: v.address,
            city: v.city,
            state: v.state,
            postalCode: v.postalCode,
            acquiredOn: v.acquiredOn,
            placedInServiceOn: v.placedInServiceOn,
            purchasePrice: v.purchasePrice,
          });
          if (r.error) setError(r.error);
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Property name">
          <Input value={v.name} required maxLength={120} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Rental type">
          <Select value={v.rentalType} onChange={(e) => set({ rentalType: e.target.value })}>
            <option value="long_term">Long-term rental</option>
            <option value="short_term">Short-term rental</option>
            <option value="mixed">Mixed use</option>
            <option value="owner_occupied">Owner-occupied (house hack)</option>
          </Select>
        </Field>
      </div>

      <div>
        <label htmlFor="pd-portfolio" className="mb-1.5 block text-sm font-medium">
          Portfolio
        </label>
        <div className="max-w-sm">
          <PortfolioSelect id="pd-portfolio" options={portfolios} value={v.portfolioId} onChange={(id) => set({ portfolioId: id })} />
        </div>
      </div>

      <Field label="Street address">
        <Input value={v.address} autoComplete="off" onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[1fr_5rem_8rem]">
        <Field label="City">
          <Input value={v.city} autoComplete="off" onChange={(e) => set({ city: e.target.value })} />
        </Field>
        <Field label="State">
          <Input value={v.state} maxLength={2} placeholder="OH" autoComplete="off" onChange={(e) => set({ state: e.target.value })} />
        </Field>
        <Field label="ZIP">
          <Input value={v.postalCode} autoComplete="off" onChange={(e) => set({ postalCode: e.target.value })} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Purchased on">
          <Input type="date" value={v.acquiredOn} onChange={(e) => set({ acquiredOn: e.target.value })} />
        </Field>
        <Field label="Placed in service" hint="When it was ready to rent. Depreciation starts here.">
          <Input type="date" value={v.placedInServiceOn} onChange={(e) => set({ placedInServiceOn: e.target.value })} />
        </Field>
        <Field label="Purchase price">
          <Input inputMode="decimal" placeholder="0.00" value={v.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} />
        </Field>
      </div>

      {error && <Notice>{error}</Notice>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || v.name.trim() === ""}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-brand-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved
          </span>
        )}
      </div>
    </form>
  );
}

interface OwnerRow {
  entityId: string;
  percent: string;
}

export function OwnersEditor({
  propertyId,
  entities,
  initial,
  primary: initialPrimary,
  locked,
}: {
  propertyId: string;
  entities: { id: string; name: string }[];
  initial: { entityId: string; percentBp: number }[];
  primary: string;
  /** The property already has transactions, so the owner that keeps the books cannot change. */
  locked: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<OwnerRow[]>(initial.map((o) => ({ entityId: o.entityId, percent: bpToPercent(o.percentBp) })));
  const [primary, setPrimary] = useState(initialPrimary);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const owners = rows.map((r) => ({ entityId: r.entityId, percentBp: percentToBp(r.percent) ?? 0 }));
  const total = owners.reduce((s, o) => s + o.percentBp, 0);
  const problem = ownershipProblem(owners, primary);
  const unused = entities.filter((e) => !rows.some((r) => r.entityId === e.id));
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.name ?? "";
  const edit = (next: OwnerRow[], nextPrimary = primary) => {
    setRows(next);
    setPrimary(nextPrimary);
    setSaved(false);
  };

  const splitEvenly = () => {
    const n = rows.length;
    const each = Math.floor(10000 / n);
    edit(rows.map((r, i) => ({ ...r, percent: bpToPercent(i === 0 ? 10000 - each * (n - 1) : each) })));
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.entityId} className="grid grid-cols-[minmax(0,1fr)_7rem_auto_auto] items-center gap-3">
            <Select
              compact
              aria-label={`Owner ${i + 1}`}
              value={r.entityId}
              onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, entityId: e.target.value } : x)), primary === r.entityId ? e.target.value : primary)}
              disabled={locked && r.entityId === primary}
            >
              {entities
                .filter((e) => e.id === r.entityId || unused.some((u) => u.id === e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </Select>
            <div className="flex items-center gap-1">
              <Input compact aria-label={`${nameOf(r.entityId)} percentage`} inputMode="decimal" className="text-right" value={r.percent} onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
              <span className="text-muted" aria-hidden>
                %
              </span>
            </div>
            <label className={`flex items-center gap-1.5 whitespace-nowrap text-[13px] ${locked && r.entityId !== primary ? "text-subtle" : "text-muted"}`}>
              <input
                type="radio"
                name="books"
                className="accent-[var(--brand-600)]"
                checked={primary === r.entityId}
                disabled={locked && r.entityId !== primary}
                onChange={() => edit(rows, r.entityId)}
              />
              Keeps the books
            </label>
            <button
              type="button"
              aria-label={`Remove ${nameOf(r.entityId)}`}
              disabled={rows.length === 1 || primary === r.entityId}
              onClick={() => edit(rows.filter((_, j) => j !== i))}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-50 disabled:opacity-30"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        {unused.length > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => edit([...rows, { entityId: unused[0].id, percent: "" }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add an owner
          </Button>
        ) : (
          <p className="text-[13px] text-muted">
            Every legal entity you have is already an owner.{" "}
            <Link href="/entities" className="font-medium text-brand-700 underline underline-offset-2">
              Add another entity
            </Link>
          </p>
        )}
        {rows.length > 1 && (
          <Button type="button" size="sm" variant="ghost" onClick={splitEvenly}>
            Split evenly
          </Button>
        )}
        <p className={`num ml-auto text-sm font-medium ${total === 10000 ? "text-brand-700" : "text-warning-fg"}`}>Total {bpToPercent(total) || "0"}%</p>
      </div>

      {locked && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-bg px-3.5 py-2.5 text-[13px] text-warning-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          This property already has transactions in {nameOf(initialPrimary)}&apos;s books, so that entity keeps the books. You can still add other owners and set percentages.
        </p>
      )}
      {rows.length > 1 && (
        <p className="text-[13px] text-muted">
          Reports show each owner its share of this property. Transactions are not split: they stay in {nameOf(primary)}&apos;s books, and the percentages decide how reports divide them.
        </p>
      )}

      {error && <Notice>{error}</Notice>}
      <div className="flex items-center gap-3">
        <Button
          disabled={pending || problem !== null}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const r = await saveOwners({ id: propertyId, primary, owners });
              if (r.error) setError(r.error);
              else {
                setSaved(true);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Save owners"}
        </Button>
        {problem && <p className="text-sm text-muted">{problem}</p>}
        {saved && !problem && (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-brand-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
