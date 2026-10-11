"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { reverseTransaction } from "./actions";

/** Cancels a transaction after a confirmation. The original stays in the books, marked as reversed. */
export function ReverseButton({ entryId, description }: { entryId: string; description: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Reverse "${description || "this transaction"}"?\n\nThe books keep a record of both. You can then add the corrected transaction.`)) return;
          setError(undefined);
          start(async () => {
            const r = await reverseTransaction(entryId);
            if ("error" in r) setError(r.error);
          });
        }}
      >
        <Undo2 className="h-4 w-4" aria-hidden /> {pending ? "Reversing…" : "Reverse"}
      </Button>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
