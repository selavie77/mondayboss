import { describe, it, expect } from "vitest";
import { planStessaImport } from "@/lib/import/stessaEntries";
import type { StessaLedger, StessaRow } from "@/lib/import/stessa";

const row = (over: Partial<StessaRow>): StessaRow => ({
  date: "2021-03-01", name: "x", notes: "", details: "", category: "Income", subCategory: "Rents",
  amountCents: 105000, property: "1 Main St", portfolio: "", source: "", account: "", dedupeHash: Math.random().toString(),
  ...over,
});
const plan = (...rows: StessaRow[]) =>
  planStessaImport([{ propertyName: "1 Main St", rows, skippedRows: 0 } as StessaLedger]);

describe("Stessa -> double-entry mapping", () => {
  it("books rent as Dr cash / Cr rental income", () => {
    const { entries } = plan(row({}));
    expect(entries[0].lines).toEqual([
      { accountCode: "1000", property: "1 Main St", debitCents: 105000, creditCents: 0 },
      { accountCode: "4000", property: "1 Main St", debitCents: 0, creditCents: 105000 },
    ]);
  });

  it("books an expense as Dr expense / Cr cash", () => {
    const { entries } = plan(row({ category: "Utilities", subCategory: "Water & Sewer", amountCents: -2622 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "5120::Water & Sewer", debitCents: 2622 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1000", creditCents: 2622 });
  });

  it("treats escrow deposits as an asset, not an expense", () => {
    const { entries } = plan(row({ category: "Transfers", subCategory: "Property Tax Escrows", amountCents: -23746 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1100", debitCents: 23746 });
  });

  it("expenses property tax paid out of escrow: Dr property tax / Cr escrow, no cash", () => {
    const { entries, review } = plan(row({
      category: "Transfers", subCategory: "General Escrow Payments", name: "Tax Disbursement",
      notes: "Tax Disbursement", amountCents: 137888,
    }));
    expect(entries).toHaveLength(0); // held for review, not auto-posted
    expect(review[0].lines[0]).toMatchObject({ accountCode: "5110", debitCents: 137888 });
    expect(review[0].lines[1]).toMatchObject({ accountCode: "1100", creditCents: 137888 });
  });

  it("posts a row with no sub-category straight to the main category, with no review flag", () => {
    const { entries, review } = plan(row({ category: "Repairs & Maintenance", subCategory: null, amountCents: -12000 }));
    expect(review).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "5090", debitCents: 12000 });
  });

  it("keeps a real sub-category as a subcategory under its category", () => {
    const { entries } = plan(row({ category: "Repairs & Maintenance", subCategory: "Plumbing Repairs", amountCents: -12000 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "5090::Plumbing Repairs" });
  });

  it("posts an unsplit mortgage payment to Mortgage Payable as debt service, in its own subcategory", () => {
    const { entries, review, unresolved } = plan(row({ category: "Mortgages & Loans", subCategory: null, amountCents: -55760 }));
    expect(unresolved).toHaveLength(0);
    expect(review).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "2100::Payments not yet split", debitCents: 55760 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1000", creditCents: 55760 });
    expect(entries[0].notes.join()).toMatch(/no principal\/interest split/);
  });

  it("posts a transfer with no sub-category to the Transfers category", () => {
    const { entries, unresolved } = plan(row({ category: "Transfers", subCategory: null, amountCents: 120000 }));
    expect(unresolved).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1000", debitCents: 120000 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "3200", creditCents: 120000 });
  });

  it("records a positive expense as a refund: money in, expense reduced, no review", () => {
    const { entries, review } = plan(row({ category: "Utilities", subCategory: "Water & Sewer", amountCents: 2622 }));
    expect(review).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1000", debitCents: 2622 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "5120::Water & Sewer", creditCents: 2622 });
    expect(entries[0].notes).toContain("Positive expenses recorded as refunds");
  });

  it("treats every expense category the same way", () => {
    for (const category of ["Insurance", "Legal & Professional", "Taxes", "Admin & Other", "Management Fees", "Repairs & Maintenance"]) {
      const { entries, review } = plan(row({ category, subCategory: null, amountCents: 5000 }));
      expect(review).toHaveLength(0);
      expect(entries[0].notes).toContain("Positive expenses recorded as refunds");
    }
  });

  it("records negative income as a refund: income reduced, money out, no review", () => {
    const { entries, review } = plan(row({ amountCents: -36500 }));
    expect(review).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "4000", debitCents: 36500 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1000", creditCents: 36500 });
    expect(entries[0].notes).toContain("Negative income recorded as refunds");
  });

  it("still holds a property tax paid from escrow for review, because it changes your deduction", () => {
    const { review } = plan(row({ category: "Transfers", subCategory: "General Escrow Payments", name: "Tax Disbursement", notes: "Tax Disbursement", amountCents: 137888 }));
    expect(review).toHaveLength(1);
  });

  it("only leaves a row unresolved when its category is unknown", () => {
    const { unresolved } = plan(row({ category: "Something Else", subCategory: null }));
    expect(unresolved[0].reason).toMatch(/Unknown category/);
  });

  it("produces balanced entries", () => {
    const { entries, review } = plan(row({}), row({ category: "Transfers", subCategory: "Owner Distributions", amountCents: -89700 }));
    for (const e of [...entries, ...review]) {
      const d = e.lines.reduce((s, l) => s + l.debitCents, 0);
      const c = e.lines.reduce((s, l) => s + l.creditCents, 0);
      expect(d).toBe(c);
    }
  });
});

describe("capital expenses and other categories seen in a full portfolio export", () => {
  it("posts a property purchase to Rental Property (Cost), not to repairs", () => {
    const { entries, review, unresolved } = plan(
      row({ category: "Capital Expenses", subCategory: "New Acquisitions", name: "***16910 Lotus Purchase***", amountCents: -6900000 }),
    );
    expect(unresolved).toHaveLength(0);
    expect(review).toHaveLength(0);
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1200::New Acquisitions", debitCents: 6900000 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1000", creditCents: 6900000 });
  });

  it("treats appliances, flooring and remodeling as capital too, keeping Stessa's sub-category", () => {
    for (const sub of ["New Appliances", "New Flooring & Carpet", "Remodeling"]) {
      const { entries } = plan(row({ category: "Capital Expenses", subCategory: sub, amountCents: -50000 }));
      expect(entries[0].lines[0]).toMatchObject({ accountCode: `1200::${sub}`, debitCents: 50000 });
    }
  });

  it("a refund of a capital expense reduces the property cost", () => {
    const { entries } = plan(row({ category: "Capital Expenses", subCategory: "Remodeling", amountCents: 42188 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1000", debitCents: 42188 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1200::Remodeling", creditCents: 42188 });
  });

  it("posts loan payoffs to Mortgage Payable under their own name, not as an unsplit payment", () => {
    const { entries } = plan(row({ category: "Mortgages & Loans", subCategory: "Proceeds & Payoffs", amountCents: -9000000 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "2100::Proceeds & Payoffs", debitCents: 9000000 });
    expect(entries[0].notes).toHaveLength(0);
  });

  it("keeps sale proceeds visible under Transfers", () => {
    const { entries } = plan(row({ category: "Transfers", subCategory: "Sale Proceeds", amountCents: 19000000 }));
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "3200::Sale Proceeds", creditCents: 19000000 });
    expect(entries[0].notes[0]).toMatch(/Sale Proceeds/);
  });
});
