import { describe, it, expect } from "vitest";
import { monthEnd, reconcileSummary, type ReconcileLine } from "@/lib/reconcile";

const lines: ReconcileLine[] = [
  { id: "a", increaseCents: 100000, decreaseCents: 0 }, // deposit
  { id: "b", increaseCents: 0, decreaseCents: 30000 }, // payment
  { id: "c", increaseCents: 50000, decreaseCents: 0 }, // deposit not on the statement
];

describe("reconciliation summary", () => {
  it("adds the ticked lines to what was reconciled before and compares with the statement", () => {
    const s = reconcileSummary({ beginningCents: 20000, lines, selected: new Set(["a", "b"]), statementCents: 90000 });
    expect(s).toEqual({ increaseCount: 1, increaseCents: 100000, decreaseCount: 1, decreaseCents: 30000, clearedCents: 90000, differenceCents: 0 });
  });

  it("shows the difference when a line is left out or ticked wrongly", () => {
    expect(reconcileSummary({ beginningCents: 20000, lines, selected: new Set(["a", "b", "c"]), statementCents: 90000 }).differenceCents).toBe(-50000);
    expect(reconcileSummary({ beginningCents: 20000, lines, selected: new Set(["a"]), statementCents: 90000 }).differenceCents).toBe(-30000);
  });

  it("starts at the statement balance less the beginning balance when nothing is ticked", () => {
    const s = reconcileSummary({ beginningCents: 20000, lines, selected: new Set(), statementCents: 20000 });
    expect(s.clearedCents).toBe(20000);
    expect(s.differenceCents).toBe(0);
  });

  it("works for a card, where charges increase the balance owed", () => {
    const card: ReconcileLine[] = [
      { id: "charge", increaseCents: 25000, decreaseCents: 0 },
      { id: "payment", increaseCents: 0, decreaseCents: 10000 },
    ];
    expect(reconcileSummary({ beginningCents: 0, lines: card, selected: new Set(["charge", "payment"]), statementCents: 15000 }).differenceCents).toBe(0);
  });
});

describe("month end", () => {
  it("finds the last day of a month, leap years included", () => {
    expect(monthEnd("2021-01-17")).toBe("2021-01-31");
    expect(monthEnd("2024-02-03")).toBe("2024-02-29");
    expect(monthEnd("2023-02-28")).toBe("2023-02-28");
    expect(monthEnd("2021-12-01")).toBe("2021-12-31");
  });
});
