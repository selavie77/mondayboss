/** The arithmetic of a bank reconciliation, in the account's normal direction (money in a bank account, money owed on a card). */

export interface ReconcileLine {
  id: string;
  /** What this line adds to the balance: a deposit, or a charge on a card. */
  increaseCents: number;
  /** What this line takes off the balance: a payment. */
  decreaseCents: number;
}

export interface ReconcileSummary {
  increaseCount: number;
  increaseCents: number;
  decreaseCount: number;
  decreaseCents: number;
  /** Everything reconciled before, plus the ticked lines. */
  clearedCents: number;
  /** The statement's ending balance less the cleared balance. Zero means you are done. */
  differenceCents: number;
}

export function reconcileSummary(o: { beginningCents: number; lines: ReconcileLine[]; selected: ReadonlySet<string>; statementCents: number }): ReconcileSummary {
  let increaseCount = 0;
  let increaseCents = 0;
  let decreaseCount = 0;
  let decreaseCents = 0;
  for (const l of o.lines) {
    if (!o.selected.has(l.id)) continue;
    if (l.increaseCents > 0) {
      increaseCount += 1;
      increaseCents += l.increaseCents;
    }
    if (l.decreaseCents > 0) {
      decreaseCount += 1;
      decreaseCents += l.decreaseCents;
    }
  }
  const clearedCents = o.beginningCents + increaseCents - decreaseCents;
  return { increaseCount, increaseCents, decreaseCount, decreaseCents, clearedCents, differenceCents: o.statementCents - clearedCents };
}

/** The last day of the month a date falls in, as yyyy-mm-dd. */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
