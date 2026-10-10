"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button, Input, Notice } from "@/components/ui";
import { updateDescription } from "./actions";

export function EditDescription({ id, value }: { id: string; value: string | null }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(value ?? "");
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
      >
        <Pencil className="h-3 w-3" aria-hidden />
        {value ? "Edit description" : "Add description"}
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-2">
      <div className="w-full sm:w-96">
        <Input
          aria-label="Description"
          value={text}
          maxLength={400}
          onChange={(e) => setText(e.target.value)}
          placeholder="What is this category for?"
          className="h-9 text-sm"
          autoFocus
        />
      </div>
      <Button
        className="h-9 px-3 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await updateDescription(id, text);
            if (r?.error) setError(r.error);
            else setEditing(false);
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && (
        <div className="w-full">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}
