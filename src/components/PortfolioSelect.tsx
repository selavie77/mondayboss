"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import { CREATE_VALUE, CreatePortfolioDialog } from "@/components/create-dialogs";

export interface PortfolioOption {
  id: string;
  name: string;
}

/** A portfolio dropdown whose last option, "Create new portfolio…", opens a small form and selects the result. */
export function PortfolioSelect({
  options,
  value,
  onChange,
  id,
  compact,
}: {
  options: PortfolioOption[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  compact?: boolean;
}) {
  const [created, setCreated] = useState<PortfolioOption[]>([]);
  const [open, setOpen] = useState(false);
  const all = [...options, ...created.filter((c) => !options.some((o) => o.id === c.id))];

  return (
    <>
      <Select
        id={id}
        compact={compact}
        value={value}
        onChange={(e) => (e.target.value === CREATE_VALUE ? setOpen(true) : onChange(e.target.value))}
      >
        {all.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={CREATE_VALUE}>＋ Create new portfolio…</option>
      </Select>
      <CreatePortfolioDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(p) => {
          setCreated((prev) => [...prev, p]);
          onChange(p.id);
          setOpen(false);
        }}
      />
    </>
  );
}
