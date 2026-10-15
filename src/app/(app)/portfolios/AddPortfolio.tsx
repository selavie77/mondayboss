"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { addPortfolio } from "./actions";

export function AddPortfolio({ entities }: { entities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(undefined);
          const r = await addPortfolio({ name, defaultEntityId: entityId || null });
          if (r.error) setError(r.error);
          else {
            setName("");
            setEntityId("");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Portfolio name" hint="A group of properties, such as “Long-term rentals” or “Ohio”.">
          <Input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Default owner (optional)" hint="New properties added to this portfolio start with this entity.">
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">No default owner</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" disabled={pending || name.trim() === ""}>
        {pending ? "Adding…" : "Add portfolio"}
      </Button>
    </form>
  );
}
