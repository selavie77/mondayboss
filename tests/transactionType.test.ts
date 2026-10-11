import { describe, it, expect } from "vitest";
import { classifyEntry, type LineKind } from "@/lib/reports/transactionType";

const bank: LineKind = { type: "asset", cashLike: true };
const card: LineKind = { type: "liability", cashLike: true };
const repairs: LineKind = { type: "expense", cashLike: false };
const rent: LineKind = { type: "income", cashLike: false };
const equity: LineKind = { type: "equity", cashLike: false };
const mortgage: LineKind = { type: "liability", cashLike: false, loan: true, debit: true };
const mortgageDraw: LineKind = { type: "liability", cashLike: false, loan: true, debit: false };
const deposits: LineKind = { type: "liability", cashLike: false };

describe("transaction type", () => {
  it("an entry with an expense is an Expense, whoever paid", () => {
    expect(classifyEntry("manual", "Home Depot", [repairs, bank])).toBe("Expense");
    expect(classifyEntry("import", "Home Depot", [repairs, card])).toBe("Expense");
  });

  it("an entry with income is Income", () => {
    expect(classifyEntry("import", "Rent", [bank, rent])).toBe("Income");
  });

  it("money moved between bank accounts, cards and loans is a Transfer", () => {
    expect(classifyEntry("manual", "Card payment", [card, bank])).toBe("Transfer");
    expect(classifyEntry("manual", "Deposit returned", [deposits, bank])).toBe("Transfer");
  });

  it("paying down a loan is a Loan payment, even when the entry also has interest", () => {
    expect(classifyEntry("import", "Principal", [mortgage, bank])).toBe("Loan payment");
    expect(classifyEntry("manual", "Mortgage payment", [mortgage, repairs, bank])).toBe("Loan payment");
  });

  it("money borrowed is Loan proceeds", () => {
    expect(classifyEntry("manual", "Refinance", [{ ...bank, debit: true }, mortgageDraw])).toBe("Loan proceeds");
  });

  it("owner money in or out is Owner equity", () => {
    expect(classifyEntry("import", "Distribution", [equity, bank])).toBe("Owner equity");
  });

  it("opening balances and reversals are recognized by how they were created", () => {
    expect(classifyEntry("system", "Opening balance: Checking", [bank, equity])).toBe("Opening balance");
    expect(classifyEntry("reversal", "Reversal of x", [repairs, bank])).toBe("Reversal");
  });

  it("anything else is a Journal entry", () => {
    expect(classifyEntry("manual", "Adjust", [])).toBe("Journal");
  });
});
