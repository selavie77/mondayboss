import type { StessaLedger, StessaRow } from "./stessa";
import { CODES, acctKey, isUnresolved, mapStessaRow, signWarning } from "./stessaMapping";

export interface DraftLine {
  /** Account key: a code, or "code::Subcategory" (see acctKey). */
  accountCode: string;
  property: string;
  debitCents: number;
  creditCents: number;
}

export interface DraftEntry {
  row: StessaRow;
  date: string;
  memo: string;
  dedupeHash: string;
  debitCode: string;
  creditCode: string;
  lines: DraftLine[];
  warnings: string[];
}

export interface UnresolvedRow {
  row: StessaRow;
  reason: string;
}

export interface ImportPlan {
  /** Mapped cleanly: safe to post automatically. */
  entries: DraftEntry[];
  /** Mapped, but something looked off. Held for a human to accept or change. */
  review: DraftEntry[];
  /** Could not be classified. Held for a human to categorize or split. */
  unresolved: UnresolvedRow[];
}

/**
 * Turn Stessa single-entry rows into balanced double-entry drafts.
 * Every row hits cash (1000) unless the mapping fixes both sides (e.g. tax paid from escrow).
 * Anything doubtful goes to `review` and anything unclassifiable to `unresolved`;
 * neither is posted without a person's say-so.
 */
export function planStessaImport(ledgers: StessaLedger[]): ImportPlan {
  const entries: DraftEntry[] = [];
  const review: DraftEntry[] = [];
  const unresolved: UnresolvedRow[] = [];

  for (const ledger of ledgers) {
    for (const row of ledger.rows) {
      const m = mapStessaRow(row);
      if (isUnresolved(m)) {
        unresolved.push({ row, reason: m.reason });
        continue;
      }
      const abs = Math.abs(row.amountCents);
      if (abs === 0) continue;

      const property = row.property;
      const warnings = [m.review, signWarning(row)].filter((w): w is string => Boolean(w));

      let debitCode: string;
      let creditCode: string;
      if (m.fixed) {
        ({ debitCode, creditCode } = m.fixed);
      } else if (row.amountCents > 0) {
        // Money in: Dr cash, Cr counter.
        debitCode = CODES.cash;
        creditCode = acctKey(m.counterCode, m.sub);
      } else {
        // Money out: Dr counter, Cr cash.
        debitCode = acctKey(m.counterCode, m.sub);
        creditCode = CODES.cash;
      }

      const entry: DraftEntry = {
        row,
        date: row.date,
        memo: [row.name, row.notes].filter(Boolean).join(" - "),
        dedupeHash: row.dedupeHash,
        debitCode,
        creditCode,
        lines: [
          { accountCode: debitCode, property, debitCents: abs, creditCents: 0 },
          { accountCode: creditCode, property, debitCents: 0, creditCents: abs },
        ],
        warnings,
      };
      (warnings.length > 0 ? review : entries).push(entry);
    }
  }
  return { entries, review, unresolved };
}
