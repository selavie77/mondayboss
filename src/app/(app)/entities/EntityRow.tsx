"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Landmark } from "lucide-react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { ENTITY_TYPES, entityTypeLabel, type EntityType } from "@/lib/entityTypes";
import { updateEntity } from "./actions";

export interface EntityRowProps {
  id: string;
  name: string;
  type: string;
  keepsBooksFor: number;
  sharesIn: number;
  hasActivity: boolean;
}

export function EntityRow({ id, name, type, keepsBooksFor, sharesIn, hasActivity }: EntityRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameText, setName] = useState(name);
  const [typeValue, setType] = useState<EntityType>(type as EntityType);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(undefined);
      const r = await updateEntity({ id, name: nameText, type: typeValue });
      if (r.error) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Landmark className="h-5 w-5" aria-hidden />
        </span>
        {editing ? (
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Input compact aria-label="Entity name" value={nameText} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <Select compact aria-label="Entity type" value={typeValue} onChange={(e) => setType(e.target.value as EntityType)}>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{name}</p>
            <p className="text-[13px] text-muted">
              {entityTypeLabel(type)} · keeps the books for {keepsBooksFor} {keepsBooksFor === 1 ? "property" : "properties"}
              {sharesIn > keepsBooksFor ? ` · owns a share of ${sharesIn}` : ""}
              {hasActivity ? "" : " · no transactions yet"}
            </p>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={pending || nameText.trim() === ""} onClick={save}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setName(name);
                  setType(type as EntityType);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
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
