"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { addCapitalExpense, type CapexState } from "./capex-actions";

// Typical IRS recovery periods for residential rentals; the user can change the life.
const KINDS: { label: string; life: number }[] = [
  { label: "New Acquisition", life: 27.5 },
  { label: "Improvement", life: 27.5 },
  { label: "Roof / Structure", life: 27.5 },
  { label: "Appliances & Equipment", life: 5 },
  { label: "Land Improvement", life: 15 },
  { label: "Furniture", life: 5 },
];

export function AddCapex({ properties, defaultPropertyId }: { properties: { id: string; name: string }[]; defaultPropertyId?: string }) {
  const [open, setOpen] = useState(false);
  const [life, setLife] = useState("27.5");
  const [state, action, pending] = useActionState<CapexState, FormData>(async (prev, formData) => {
    const r = await addCapitalExpense(prev, formData);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="print:hidden">
        <Plus className="h-4 w-4" aria-hidden /> Add a capital expense
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] print:hidden">
      <h3 className="text-lg font-semibold">Add a capital expense</h3>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Property">
          <Select name="property_id" defaultValue={defaultPropertyId ?? properties[0]?.id} required>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" hint="For example, “126 E Orchard Springs Purchase” or “New roof”.">
          <Input name="name" required />
        </Field>
        <Field label="Type">
          <Select name="sub_category" defaultValue="New Acquisition" onChange={(e) => setLife(String(KINDS.find((k) => k.label === e.target.value)?.life ?? 27.5))}>
            {KINDS.map((k) => (
              <option key={k.label} value={k.label}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount">
          <Input name="amount" inputMode="decimal" placeholder="90,000.00" required />
        </Field>
        <Field label="Date paid">
          <Input name="spent_on" type="date" required />
        </Field>
        <Field label="Placed in service" hint="Leave blank to use the date paid.">
          <Input name="placed_in_service_on" type="date" />
        </Field>
        <Field label="Useful life (years)" hint="27.5 for a residential building; 5 for most appliances.">
          <Input name="useful_life_years" inputMode="decimal" value={life} onChange={(e) => setLife(e.target.value)} required />
        </Field>
        <Field label="Notes (optional)">
          <Input name="notes" />
        </Field>
      </div>
      {state?.error && <Notice>{state.error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add capital expense"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
