import type { StessaLedger, StessaRow } from "./stessa";
import { CODES, isUnresolved, mapStessaRow, signWarning } from "./stessaMapping";

export interface DraftLine {
  accountCode: string;
  property: string;
  debitCents: number;
  creditCents: number;
}

export interface DraftEntry {
  date: string;
  memo: string;
  dedupeHash: string;
  lines: DraftLine[];
  warnings: string[];
}

export interface UnresolvedRow {
  row: StessaRow;
  reason: string;
}

export interface ImportPlan {
  entries: DraftEntry[];
  unresolved: UnresolvedRow[];
}

/**
 * Turn Stessa single-entry rows into balanced double-entry drafts.
 * Every row hits cash (1000) unless the mapping fixes both sides (e.g. tax paid from escrow).
 * Rows that cannot be classified are returned in `unresolved`, never guessed.
 */
export function planStessaImport(ledgers: StessaLedger[]): ImportPlan {
  const entries: DraftEntry[] = [];
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
        creditCode = m.counterCode;
      } else {
        // Money out: Dr counter, Cr cash.
        debitCode = m.counterCode;
        creditCode = CODES.cash;
      }

      entries.push({
        date: row.date,
        memo: [row.name, row.notes].filter(Boolean).join(" - "),
        dedupeHash: row.dedupeHash,
        lines: [
          { accountCode: debitCode, property, debitCents: abs, creditCents: 0 },
          { accountCode: creditCode, property, debitCents: 0, creditCents: abs },
        ],
        warnings,
      });
    }
  }
  return { entries, unresolved };
}
