/** Convert a dollar amount (number or string) to integer cents without float drift. */
export function toCents(value: number | string): number {
  const n = typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
  return Math.round(n * 100);
}

/** Report style: whole dollars (or exact with showCents), negatives in parentheses, zero as a dash. */
export function formatAmount(cents: number, showCents: boolean): string {
  const value = showCents ? cents / 100 : Math.round(cents / 100);
  if (value === 0) return "–";
  const text = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
  return value < 0 ? `(${text})` : text;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
