"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FolderTree } from "lucide-react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { deletePortfolio, updatePortfolio } from "./actions";

export interface PortfolioRowProps {
  id: string;
  name: string;
  defaultEntityId: string | null;
  propertyCount: number;
  /** The entities that own something in this portfolio, with how many properties each. */
  owners: { name: string; count: number }[];
  entities: { id: string; name: string }[];
}

export function PortfolioRow({ id, name, defaultEntityId, propertyCount, owners, entities }: PortfolioRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameText, setName] = useState(name);
  const [entityId, setEntityId] = useState(defaultEntityId ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const defaultName = entities.find((e) => e.id === defaultEntityId)?.name;

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <FolderTree className="h-5 w-5" aria-hidden />
        </span>
        {editing ? (
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
            <Input compact aria-label="Portfolio name" value={nameText} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <Select compact aria-label="Default owner" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">No default owner</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  Default owner: {e.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{name}</p>
            <p className="text-[13px] text-muted">
              {propertyCount} {propertyCount === 1 ? "property" : "properties"}
              {defaultName ? ` · new properties start with ${defaultName}` : " · no default owner"}
              {owners.length > 0 ? ` · owned by ${owners.map((o) => `${o.name} (${o.count})`).join(", ")}` : ""}
            </p>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={pending || nameText.trim() === ""}
                onClick={() => run(() => updatePortfolio({ id, name: nameText, defaultEntityId: entityId || null }), () => setEditing(false))}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setName(name);
                  setEntityId(defaultEntityId ?? "");
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              {propertyCount === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete the portfolio "${name}"? It has no properties.`)) run(() => deletePortfolio(id));
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </li>
  );
}
