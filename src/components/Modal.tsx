"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const noopSubscribe = () => () => {};

/**
 * A modal dialog built on the native <dialog> element: focus is trapped, Esc closes it, and the backdrop dims the page.
 * It is rendered at the top of the page (a portal), so it works inside another form without nesting forms.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // false while rendering on the server, true in the browser.
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, inBrowser]);

  if (!inBrowser) return null;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto ${size === "lg" ? "w-[min(44rem,94vw)]" : "w-[min(34rem,92vw)]"} max-h-[92vh] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40`}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-50">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}
