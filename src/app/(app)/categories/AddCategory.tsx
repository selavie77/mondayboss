"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Input, Notice, Select } from "@/components/ui";
import { SCHEDULE_E_LINES } from "@/lib/taxLines";
import { createCategory, type CategoryState } from "./actions";

export function AddCategory({
  entityId,
  type,
  parentId,
  parentName,
}: {
  entityId: string;
  type: string;
  parentId?: string;
  parentName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Closing unmounts the form, which also clears it for the next add.
  const [state, action, pending] = useActionState<CategoryState, FormData>(async (prev, formData) => {
    const result = await createCategory(prev, formData);
    if (result?.ok) setOpen(false);
    return result;
  }, undefined);

  const isSub = Boolean(parentId);
  const taxLines = SCHEDULE_E_LINES.filter((l) => l.kind === (type === "income" ? "income" : "expense"));
  const wantsTaxLine = !isSub && (type === "income" || type === "expense");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {isSub ? "Add subcategory" : "Add category"}
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 flex flex-wrap items-start gap-2 rounded-xl border border-border bg-background p-3">
      <input type="hidden" name="entity_id" value={entityId} />
      <input type="hidden" name="type" value={type} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <div className="w-full sm:w-64">
        <Input
          name="name"
          aria-label={isSub ? `New subcategory under ${parentName}` : "New category name"}
          placeholder={isSub ? `New subcategory under ${parentName}` : "Category name"}
          compact
          autoFocus
          required
        />
      </div>
      <div className="w-full">
        <Input
          name="description"
          aria-label="Description"
          placeholder="What is this for? (optional)"
          maxLength={400}
          compact
        />
      </div>
      {wantsTaxLine && (
        <div className="w-full sm:w-64">
          <Select name="tax_line" aria-label="Schedule E line" defaultValue="" compact>
            <option value="">Schedule E line (optional)</option>
            {taxLines.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state?.error && (
        <div className="w-full">
          <Notice>{state.error}</Notice>
        </div>
      )}
    </form>
  );
}
