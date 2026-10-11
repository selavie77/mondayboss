"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoImport } from "./actions";

/** Reverses an import after a confirmation that says exactly what will change. */
export function UndoImportButton({ batchId, posted, pending: waiting, filename }: { batchId: string; posted: number; pending: number; filename: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className="text-[13px] font-medium text-brand-700 hover:underline disabled:opacity-60"
        onClick={() => {
          const what = [posted > 0 ? `${posted.toLocaleString("en-US")} posted transactions will be reversed (the history keeps them)` : "", waiting > 0 ? `${waiting.toLocaleString("en-US")} waiting in Review will be removed` : ""].filter(Boolean).join(", and ");
          const ok = window.confirm(
            `Undo this import${filename ? ` (${filename})` : ""}?\n\n${what || "Nothing was posted from it."}.\n\nProperties, accounts and portfolios it created stay. You can import the same file again afterwards.`,
          );
          if (!ok) return;
          setMessage(undefined);
          start(async () => {
            const r = await undoImport(batchId);
            if (r.error) setMessage({ tone: "error", text: r.error });
            else {
              setMessage({ tone: "ok", text: `Reversed ${(r.reversed ?? 0).toLocaleString("en-US")} transactions.` });
              router.refresh();
            }
          });
        }}
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      {message && (
        <span role={message.tone === "error" ? "alert" : "status"} className={`max-w-xs text-right text-[12px] ${message.tone === "error" ? "text-warning-fg" : "text-muted"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
