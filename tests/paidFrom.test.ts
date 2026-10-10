import { describe, it, expect } from "vitest";
import { resolvePaidFrom, type CashAccount } from "@/lib/paidFrom";

const acct = (id: string, code: string, over: Partial<CashAccount> = {}): CashAccount => ({
  id,
  code,
  isBank: true,
  subtype: "cash",
  propertyId: null,
  portfolioId: null,
  ...over,
});
const card = (id: string, code: string, over: Partial<CashAccount> = {}) => acct(id, code, { isBank: false, subtype: "credit_card", ...over });

const house = { id: "p1", portfolioId: "pf1" };

describe("default paid-from account", () => {
  const general = acct("op", "1000");

  it("prefers an account tied to the property", () => {
    const accounts = [general, acct("pf-bank", "1020", { portfolioId: "pf1" }), acct("p-bank", "1030", { propertyId: "p1" })];
    expect(resolvePaidFrom(house, accounts)).toBe("p-bank");
  });

  it("then an account tied to the property's portfolio", () => {
    const accounts = [general, acct("pf-bank", "1020", { portfolioId: "pf1" }), acct("other", "1030", { propertyId: "p2" })];
    expect(resolvePaidFrom(house, accounts)).toBe("pf-bank");
  });

  it("then the entity's general account, never another property's account", () => {
    const accounts = [acct("other", "1030", { propertyId: "p2" }), general, acct("elsewhere", "1040", { portfolioId: "pf9" })];
    expect(resolvePaidFrom(house, accounts)).toBe("op");
  });

  it("prefers a bank account over a credit card at the same level, but uses the card if it is all there is", () => {
    expect(resolvePaidFrom(house, [general, card("c", "2300", { propertyId: "p1" }), acct("b", "1031", { propertyId: "p1" })])).toBe("b");
    expect(resolvePaidFrom(house, [general, card("c", "2300", { propertyId: "p1" })])).toBe("c");
  });

  it("falls back to the first general bank account when there is no 1000", () => {
    expect(resolvePaidFrom(house, [acct("b2", "1020"), acct("b1", "1010")])).toBe("b1");
  });

  it("ignores accounts that are not cash-like, and returns null when there is nothing to use", () => {
    expect(resolvePaidFrom(house, [{ id: "x", code: "1200", isBank: false, subtype: "fixed_asset", propertyId: "p1", portfolioId: null }])).toBeNull();
    expect(resolvePaidFrom(null, [])).toBeNull();
  });

  it("with no property, uses the general account", () => {
    expect(resolvePaidFrom(null, [general, acct("p-bank", "1030", { propertyId: "p1" })])).toBe("op");
  });
});
