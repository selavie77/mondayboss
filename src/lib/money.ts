/** Convert a dollar amount (number or string) to integer cents without float drift. */
export function toCents(value: number | string): number {
  const n = typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
  return Math.round(n * 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
