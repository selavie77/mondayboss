import type { AccountType } from "./types";

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentName: string | null;
}

export interface LedgerLine {
  accountId: string;
  date: string;
  /** Tie-breaker within a date: creation order of the journal entry, then the line. */
  order: string;
  description: string;
  property: string;
  debitCents: number;
  creditCents: number;
}

export interface LedgerEntry {
  date: string;
  description: string;
  property: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface LedgerGroup {
  account: LedgerAccount;
  openingCents: number;
  debitsCents: number;
  creditsCents: number;
  closingCents: number;
  entries: LedgerEntry[];
}

/** Assets and expenses grow with debits; liabilities, equity and income grow with credits. */
export const naturalSign = (type: AccountType): 1 | -1 => (type === "asset" || type === "expense" ? 1 : -1);

/**
 * Group journal lines by account with running balances in each account's natural direction.
 * `opening` is the debit-minus-credit balance before the first line. Accounts with no activity and a
 * zero opening balance are left out.
 */
export function buildLedger(accounts: LedgerAccount[], lines: LedgerLine[], opening: Map<string, number>): LedgerGroup[] {
  const byAccount = new Map<string, LedgerLine[]>();
  for (const l of lines) byAccount.set(l.accountId, [...(byAccount.get(l.accountId) ?? []), l]);

  const groups: LedgerGroup[] = [];
  for (const account of accounts) {
    const own = (byAccount.get(account.id) ?? []).sort(
      (a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order),
    );
    const sign = naturalSign(account.type);
    const openingCents = sign * (opening.get(account.id) ?? 0);
    if (own.length === 0 && openingCents === 0) continue;

    let balance = openingCents;
    let debits = 0;
    let credits = 0;
    const entries: LedgerEntry[] = own.map((l) => {
      balance += sign * (l.debitCents - l.creditCents);
      debits += l.debitCents;
      credits += l.creditCents;
      return {
        date: l.date,
        description: l.description,
        property: l.property,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        balanceCents: balance,
      };
    });
    groups.push({ account, openingCents, debitsCents: debits, creditsCents: credits, closingCents: balance, entries });
  }
  return groups.sort((a, b) => a.account.code.localeCompare(b.account.code, undefined, { numeric: true }));
}
