export interface LineKind {
  type: "asset" | "liability" | "equity" | "income" | "expense";
  /** A bank account or credit card. */
  cashLike: boolean;
}

export type TransactionKind = "Expense" | "Income" | "Transfer" | "Owner equity" | "Opening balance" | "Reversal" | "Journal";

/**
 * A plain-language label for a journal entry, the way Zoho's Account Transactions report shows a type.
 * It is worked out from the accounts the entry touches, so imported and hand-entered entries read alike.
 */
export function classifyEntry(source: string, memo: string | null, lines: LineKind[]): TransactionKind {
  if (source === "reversal") return "Reversal";
  if (source === "system" && (memo ?? "").startsWith("Opening balance")) return "Opening balance";
  if (lines.some((l) => l.type === "expense")) return "Expense";
  if (lines.some((l) => l.type === "income")) return "Income";
  if (lines.some((l) => l.type === "equity")) return "Owner equity";
  if (lines.length > 0 && lines.every((l) => l.type === "asset" || l.type === "liability")) return "Transfer";
  return "Journal";
}
