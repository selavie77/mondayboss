/** How an amount typed on the Opening balances screen becomes an opening balance. */
export type OpeningMode = "statement" | "opening";

/**
 * "statement": the amount is the balance on a statement date, so the opening balance is that balance minus
 * everything the imported transactions have moved it by since. "opening": the amount is the opening balance itself.
 * Both are in the account's normal direction (money in a bank account, or money owed on a card or loan).
 */
export function openingFromAmount(mode: OpeningMode, amountCents: number, movementCents: number): number {
  return mode === "statement" ? amountCents - movementCents : amountCents;
}

/** The day before a date, as yyyy-mm-dd. */
export function dayBefore(date: string): string {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Opening balances are for the time before your records start, so they must not be dated after the first transaction. */
export function openingDateProblem(asOf: string, firstActivity: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "Enter the opening balance date.";
  if (firstActivity && asOf > firstActivity) return `The opening date must be on or before your first transaction (${firstActivity}).`;
  return null;
}
