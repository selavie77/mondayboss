import { describe, it, expect } from "vitest";
import { dayBefore, openingDateProblem, openingFromAmount } from "@/lib/openingBalance";

describe("opening balance from a statement", () => {
  it("subtracts the activity since the opening date from the statement balance", () => {
    // Statement shows $5,000. Imports added $20,000, so the account started $15,000 lower.
    expect(openingFromAmount("statement", 500000, 2000000)).toBe(-1500000);
    // A mortgage: $85,000 owed now, $5,000 paid down since, so $90,000 was owed at the start.
    expect(openingFromAmount("statement", 8500000, -500000)).toBe(9000000);
  });

  it("uses the amount as it is when it is the opening balance itself", () => {
    expect(openingFromAmount("opening", 123400, 999999)).toBe(123400);
  });

  it("is zero when the statement already agrees with the imported activity", () => {
    expect(openingFromAmount("statement", 700000, 700000)).toBe(0);
  });
});

describe("opening dates", () => {
  it("is the day before a date, across month and year ends", () => {
    expect(dayBefore("2021-01-01")).toBe("2020-12-31");
    expect(dayBefore("2021-03-01")).toBe("2021-02-28");
  });

  it("must not fall after the first transaction", () => {
    expect(openingDateProblem("2021-01-27", "2021-01-28")).toBeNull();
    expect(openingDateProblem("2021-01-28", "2021-01-28")).toBeNull();
    expect(openingDateProblem("2021-02-01", "2021-01-28")).toMatch(/on or before/);
    expect(openingDateProblem("", null)).toMatch(/Enter/);
    expect(openingDateProblem("2021-02-01", null)).toBeNull();
  });
});
