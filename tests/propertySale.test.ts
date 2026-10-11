import { describe, it, expect } from "vitest";
import { computeSale, factsFromRows, type SaleFacts } from "@/lib/propertySale";

const acct = { proceeds: "cash", loan: "loan", deposits: "deposits", escrow: "escrow", accumDepr: "accum", gain: "gain" };
const facts = (over: Partial<SaleFacts> = {}): SaleFacts => ({
  cost: [{ accountId: "cost", cents: 9000000 }],
  accumDeprCents: 0,
  accumDeprAccountId: null,
  loanCents: 6000000,
  escrowCents: 0,
  depositsCents: 0,
  recordedProceedsCents: 0,
  ...over,
});
const input = (over = {}) => ({ priceCents: 12000000, costsCents: 800000, payoffCents: 6000000, depositsCents: 0, escrowCents: 0, ...over });
const sum = (r: ReturnType<typeof computeSale>, side: "debitCents" | "creditCents") => r.lines.reduce((s, l) => s + l[side], 0);
const line = (r: ReturnType<typeof computeSale>, id: string) => r.lines.find((l) => l.accountId === id);

describe("selling a property", () => {
  it("books the cash, clears the loan and cost, and records the gain", () => {
    // $120,000 price, $8,000 costs, $60,000 loan, $90,000 cost: cash $52,000, gain $22,000.
    const r = computeSale(facts(), input(), acct);
    expect(r.netProceedsCents).toBe(5200000);
    expect(r.gainCents).toBe(2200000);
    expect(line(r, "cash")?.debitCents).toBe(5200000);
    expect(line(r, "loan")?.debitCents).toBe(6000000);
    expect(line(r, "cost")?.creditCents).toBe(9000000);
    expect(line(r, "gain")?.creditCents).toBe(2200000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
    expect(r.problems).toEqual([]);
  });

  it("records a loss as a debit", () => {
    const r = computeSale(facts(), input({ priceCents: 8000000, costsCents: 500000, payoffCents: 5000000 }), acct);
    expect(r.gainCents).toBe(-1500000); // 80,000 - 5,000 - 90,000
    expect(line(r, "gain")?.debitCents).toBe(1500000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("adds back depreciation already taken, so the gain is measured against book value", () => {
    const r = computeSale(facts({ accumDeprCents: 1500000, accumDeprAccountId: "accum" }), input(), acct);
    expect(r.gainCents).toBe(3700000); // 112,000 - (90,000 - 15,000)
    expect(line(r, "accum")?.debitCents).toBe(1500000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("handles deposits handed to the buyer and escrow refunded to you", () => {
    const r = computeSale(facts(), input({ depositsCents: 200000, escrowCents: 150000 }), acct);
    expect(r.netProceedsCents).toBe(5200000 - 200000 + 150000);
    expect(line(r, "deposits")?.debitCents).toBe(200000);
    expect(line(r, "escrow")?.creditCents).toBe(150000);
    expect(r.gainCents).toBe(2200000); // deposits and escrow are not part of the gain
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("removes cost from every account it sits in, including ones with a credit balance", () => {
    const r = computeSale(facts({ cost: [{ accountId: "acq", cents: 9500000 }, { accountId: "remodel", cents: -500000 }] }), input(), acct);
    expect(line(r, "acq")?.creditCents).toBe(9500000);
    expect(line(r, "remodel")?.debitCents).toBe(500000);
    expect(r.costBasisCents).toBe(9000000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("takes cash from you when the payoff is more than the sale brings in", () => {
    const r = computeSale(facts(), input({ priceCents: 5000000, costsCents: 300000, payoffCents: 6000000 }), acct);
    expect(r.netProceedsCents).toBe(-1300000);
    expect(line(r, "cash")?.creditCents).toBe(1300000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("warns when no cost is recorded, since the whole price would be gain", () => {
    const r = computeSale(facts({ cost: [] }), input(), acct);
    expect(r.warnings.join(" ")).toMatch(/No cost is recorded/);
    expect(r.gainCents).toBe(11200000);
    expect(sum(r, "debitCents")).toBe(sum(r, "creditCents"));
  });

  it("warns when the payoff exceeds the loan balance", () => {
    expect(computeSale(facts({ loanCents: 100000 }), input(), acct).warnings.join(" ")).toMatch(/more than the loan balance/);
  });

  it("does not warn about the payoff when none is entered, even if the loan balance is not positive", () => {
    expect(computeSale(facts({ loanCents: -300000 }), input({ payoffCents: 0 }), acct).warnings.join(" ")).not.toMatch(/loan balance/);
  });

  it("asks for what is missing before it can be recorded", () => {
    expect(computeSale(facts(), input({ priceCents: 0 }), acct).problems).toContain("Enter the sale price.");
    expect(computeSale(facts(), input({ costsCents: -1 }), acct).problems.join(" ")).toMatch(/negative/);
    expect(computeSale(facts(), input(), { ...acct, loan: null }).problems.join(" ")).toMatch(/loan account/);
  });
});

describe("reading the books", () => {
  it("turns the facts query into totals", () => {
    const f = factsFromRows([
      { kind: "cost", account_id: "a", cents: "9000000" },
      { kind: "cost", account_id: "b", cents: 100 },
      { kind: "accum_depr", account_id: "d", cents: 500 },
      { kind: "loan", account_id: "l", cents: 7000 },
      { kind: "proceeds", account_id: "p", cents: 9000 },
    ]);
    expect(f.cost).toEqual([{ accountId: "a", cents: 9000000 }, { accountId: "b", cents: 100 }]);
    expect(f.accumDeprCents).toBe(500);
    expect(f.accumDeprAccountId).toBe("d");
    expect(f.loanCents).toBe(7000);
    expect(f.recordedProceedsCents).toBe(9000);
    expect(f.escrowCents).toBe(0);
  });
});
