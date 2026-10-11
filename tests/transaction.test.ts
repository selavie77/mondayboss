import { describe, it, expect } from "vitest";
import { STEP_LABELS, resolveSides } from "@/lib/transaction";

describe("which side each account lands on", () => {
  it("expense: debit the category, credit the account it was paid from", () => {
    expect(resolveSides({ type: "expense", category: "repairs", account: "checking" })).toEqual({ debit: "repairs", credit: "checking" });
  });

  it("expense paid by credit card credits the card", () => {
    expect(resolveSides({ type: "expense", category: "repairs", account: "card" })).toEqual({ debit: "repairs", credit: "card" });
  });

  it("income: debit the account it went into, credit the category", () => {
    expect(resolveSides({ type: "income", category: "rent", account: "checking" })).toEqual({ debit: "checking", credit: "rent" });
  });

  it("transfer: debit where it went, credit where it came from (a card payment reduces the card balance)", () => {
    expect(resolveSides({ type: "transfer", from: "checking", to: "card" })).toEqual({ debit: "card", credit: "checking" });
  });

  it("other: exactly the debit and credit accounts chosen", () => {
    expect(resolveSides({ type: "other", debit: "cost", credit: "mortgage" })).toEqual({ debit: "cost", credit: "mortgage" });
  });
});

describe("incomplete or contradictory picks", () => {
  it("asks for whatever is missing, in plain language", () => {
    expect(resolveSides({ type: "expense", account: "checking" })).toEqual({ error: "Choose what the expense was for." });
    expect(resolveSides({ type: "expense", category: "repairs" })).toEqual({ error: "Choose how you paid." });
    expect(resolveSides({ type: "income", category: "rent" })).toEqual({ error: "Choose where the money was sent." });
    expect(resolveSides({ type: "transfer", from: "checking" })).toEqual({ error: "Choose where the money went." });
    expect(resolveSides({ type: "other", debit: "a" })).toEqual({ error: "Choose the credit account." });
  });

  it("refuses the same account on both sides", () => {
    expect(resolveSides({ type: "transfer", from: "checking", to: "checking" })).toEqual({ error: "The two accounts must be different." });
    expect(resolveSides({ type: "other", debit: "x", credit: "x" })).toEqual({ error: "The two accounts must be different." });
  });
});

describe("labels", () => {
  it("change with the type", () => {
    expect(STEP_LABELS.expense.second).toBe("How did you pay?");
    expect(STEP_LABELS.income.second).toBe("Where was the money sent?");
    expect(STEP_LABELS.transfer).toEqual({ first: "Moved from", second: "Moved to" });
  });
});
