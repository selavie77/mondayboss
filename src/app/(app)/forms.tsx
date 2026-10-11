"use client";

import { useActionState, useState } from "react";
import { PortfolioSelect } from "@/components/PortfolioSelect";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { createEntity, createProperty, type FormState } from "./actions";

export function EntityForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createEntity, undefined);
  return (
    <form action={action} className="space-y-5">
      <Field label="Entity name" hint="The person or company that owns the property, e.g. “Bamileke Holdings LLC”.">
        <Input name="name" placeholder="My Rentals LLC" required autoFocus />
      </Field>
      <Field label="Entity type">
        <Select name="type" defaultValue="llc">
          <option value="llc">LLC</option>
          <option value="individual">Individual (personal name)</option>
          <option value="s_corp">S corporation</option>
          <option value="c_corp">C corporation</option>
          <option value="partnership">Partnership</option>
          <option value="trust">Trust</option>
        </Select>
      </Field>
      {state?.error && <Notice>{state.error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Setting up your books…" : "Continue"}
      </Button>
    </form>
  );
}

export interface Option {
  id: string;
  name: string;
}

export function PropertyForm({
  entities,
  portfolios,
  defaultEntityId,
}: {
  entities: Option[];
  portfolios: Option[];
  defaultEntityId?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProperty, undefined);
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? "");

  return (
    <form action={action} className="space-y-5">
      <Field label="Property name" hint="A nickname you'll recognize, such as the street address.">
        <Input name="name" placeholder="126 E Orchard Springs Dr" required autoFocus />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Owned by">
          <Select name="entity_id" defaultValue={defaultEntityId ?? entities[0]?.id} required>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rental type">
          <Select name="rental_type" defaultValue="long_term">
            <option value="long_term">Long-term rental</option>
            <option value="short_term">Short-term rental</option>
            <option value="mixed">Mixed use</option>
            <option value="owner_occupied">Owner-occupied (house hack)</option>
          </Select>
        </Field>
      </div>

      <div>
        <label htmlFor="property-portfolio" className="mb-1.5 block text-sm font-medium">
          Portfolio
        </label>
        <PortfolioSelect id="property-portfolio" options={portfolios} value={portfolioId} onChange={setPortfolioId} />
        <input type="hidden" name="portfolio_id" value={portfolioId} />
      </div>

      <Field label="Street address (optional)">
        <Input name="address_line1" autoComplete="off" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[1fr_5rem_8rem]">
        <Field label="City">
          <Input name="city" autoComplete="off" />
        </Field>
        <Field label="State">
          <Input name="state" maxLength={2} placeholder="OH" autoComplete="off" />
        </Field>
        <Field label="ZIP">
          <Input name="postal_code" autoComplete="off" />
        </Field>
      </div>

      {state?.error && <Notice>{state.error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add property"}
      </Button>
    </form>
  );
}
