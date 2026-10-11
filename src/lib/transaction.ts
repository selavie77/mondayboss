export type TransactionType = "expense" | "income" | "transfer" | "other";

export const TYPE_LABELS: { type: TransactionType; label: string; hint: string }[] = [
  { type: "expense", label: "Expense", hint: "Money you spent" },
  { type: "income", label: "Income", hint: "Money you received" },
  { type: "transfer", label: "Transfer", hint: "Money moved between your own accounts" },
  { type: "other", label: "Other", hint: "Choose the debit and credit accounts yourself" },
];

/** The questions change with the type, in plain language. */
export const STEP_LABELS: Record<TransactionType, { first: string; second: string }> = {
  expense: { first: "What was it for?", second: "How did you pay?" },
  income: { first: "What kind of income?", second: "Where was the money sent?" },
  transfer: { first: "Moved from", second: "Moved to" },
  other: { first: "Debit account", second: "Credit account" },
};

/** What the person picked. Which fields matter depends on the type. */
export interface TransactionPicks {
  type: TransactionType;
  /** Expense or income: the category. */
  category?: string;
  /** Expense: the account it was paid from. Income: the account the money went into. */
  account?: string;
  /** Transfer. */
  from?: string;
  to?: string;
  /** Other. */
  debit?: string;
  credit?: string;
}

/**
 * The two accounts a transaction touches. Every transaction is one balanced entry:
 *   expense:  Dr category                 / Cr account it was paid from
 *   income:   Dr account it went into     / Cr category
 *   transfer: Dr account moved to         / Cr account moved from
 *   other:    Dr debit account            / Cr credit account
 */
export function resolveSides(p: TransactionPicks): { debit: string; credit: string } | { error: string } {
  const need = (id: string | undefined, message: string) => (id ? null : { error: message });

  let debit: string | undefined;
  let credit: string | undefined;
  let missing: { error: string } | null = null;

  switch (p.type) {
    case "expense":
      missing = need(p.category, "Choose what the expense was for.") ?? need(p.account, "Choose how you paid.");
      debit = p.category;
      credit = p.account;
      break;
    case "income":
      missing = need(p.category, "Choose what kind of income it was.") ?? need(p.account, "Choose where the money was sent.");
      debit = p.account;
      credit = p.category;
      break;
    case "transfer":
      missing = need(p.from, "Choose where the money came from.") ?? need(p.to, "Choose where the money went.");
      debit = p.to;
      credit = p.from;
      break;
    case "other":
      missing = need(p.debit, "Choose the debit account.") ?? need(p.credit, "Choose the credit account.");
      debit = p.debit;
      credit = p.credit;
      break;
  }

  if (missing) return missing;
  if (debit === credit) return { error: "The two accounts must be different." };
  return { debit: debit!, credit: credit! };
}
