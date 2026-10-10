"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleFavorite } from "./prefs-actions";

export function StarButton({
  reportKey,
  initial,
  onChange,
  size = "md",
}: {
  reportKey: string;
  initial: boolean;
  onChange?: (favorite: boolean) => void;
  size?: "sm" | "md";
}) {
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      onClick={() => {
        const next = !on;
        setOn(next); // optimistic
        onChange?.(next);
        start(async () => {
          try {
            const confirmed = await toggleFavorite(reportKey);
            setOn(confirmed);
            onChange?.(confirmed);
          } catch {
            setOn(!next);
            onChange?.(!next);
          }
        });
      }}
      className="grid shrink-0 place-items-center rounded-lg p-1.5 text-subtle transition hover:bg-brand-50 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <Star className={`${size === "sm" ? "h-4 w-4" : "h-5 w-5"} ${on ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
    </button>
  );
}
