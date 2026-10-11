export interface LineKind {
  type: "asset" | "liability" | "equity" | "income" | "expense";
  /** A bank account or credit card. */
  cashLike: boolean;
  /** A loan, such as a mortgage. */
  loan?: boolean;
  /** This line is a debit (otherwise a credit). */
  debit?: boolean;
}

export type TransactionKind = "Expense" | "Income" | "Loan payment" | "Loan proceeds" | "Transfer" | "Owner equity" | "Opening balance" | "Reversal" | "Journal";

/**
 * A plain-language label for a journal entry, the way Zoho's Account Transactions report shows a type.
 * It is worked out from the accounts the entry touches, so imported and hand-entered entries read alike.
 */
export function classifyEntry(source: string, memo: string | null, lines: LineKind[]): TransactionKind {
  if (source === "reversal") return "Reversal";
  if (source === "system" && (memo ?? "").startsWith("Opening balance")) return "Opening balance";
  // Paying down a loan reduces what you owe (a debit to the loan), whatever else is in the entry.
  if (lines.some((l) => l.loan && l.debit)) return "Loan payment";
  if (lines.some((l) => l.type === "expense")) return "Expense";
  if (lines.some((l) => l.type === "income")) return "Income";
  if (lines.some((l) => l.type === "equity")) return "Owner equity";
  if (lines.some((l) => l.loan && l.debit === false)) return "Loan proceeds";
  if (lines.length > 0 && lines.every((l) => l.type === "asset" || l.type === "liability")) return "Transfer";
  return "Journal";
}
