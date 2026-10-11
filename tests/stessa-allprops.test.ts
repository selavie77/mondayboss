import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseStessaLedger, readStessaSheet } from "@/lib/import/stessa";

/** A tiny Stessa-shaped worksheet: title on row 2, headers on row 4, data from row 6. */
function sheet(title: string, rows: { date: string; name: string; amount: number; property: string; category?: string; sub?: string }[]) {
  const ws = new ExcelJS.Workbook().addWorksheet("Report");
  ws.getRow(2).getCell(1).value = title;
  ws.getRow(4).values = ["", "Date", "Name", "Notes", "Details", "Category", "Sub-Category", "Amount", "Portfolio", "Property"];
  rows.forEach((r, i) => {
    ws.getRow(6 + i).values = ["", r.date, r.name, "", "", r.category ?? "Income", r.sub ?? "Rents", r.amount, "P", r.property];
  });
  return ws;
}

const row = { date: "03/05/2021", name: "Knight", amount: 1050, property: "1 Main St" };

describe("Stessa exports that cover one property or all of them", () => {
  it("reads the properties from the rows, not the title, for an all-properties export", () => {
    const ledger = readStessaSheet(
      sheet("General Ledger for All Properties", [row, { ...row, property: "2 Oak Ave" }, { ...row, date: "04/05/2021" }]),
    );
    expect(ledger.propertyName).toBe("All Properties");
    expect(ledger.properties.sort()).toEqual(["1 Main St", "2 Oak Ave"]);
    expect(ledger.rows.map((r) => r.property)).toEqual(["1 Main St", "2 Oak Ave", "1 Main St"]);
  });

  it("gives the same fingerprint to a transaction whichever kind of file it came from", () => {
    const fromProperty = readStessaSheet(sheet("General Ledger for 1 Main St", [row]));
    const fromAll = readStessaSheet(sheet("General Ledger for All Properties", [row, { ...row, property: "2 Oak Ave" }]));
    const same = fromAll.rows.find((r) => r.property === "1 Main St")!;
    expect(same.dedupeHash).toBe(fromProperty.rows[0].dedupeHash);
    // A different property's identical-looking transaction is a different transaction.
    expect(fromAll.rows.find((r) => r.property === "2 Oak Ave")!.dedupeHash).not.toBe(same.dedupeHash);
  });

  it("numbers repeated identical rows the same way in both kinds of file", () => {
    const fromProperty = readStessaSheet(sheet("General Ledger for 1 Main St", [row, row]));
    const fromAll = readStessaSheet(sheet("General Ledger for All Properties", [row, { ...row, property: "2 Oak Ave" }, row]));
    const hashes = fromAll.rows.filter((r) => r.property === "1 Main St").map((r) => r.dedupeHash);
    expect(hashes).toEqual(fromProperty.rows.map((r) => r.dedupeHash));
    expect(new Set(hashes).size).toBe(2);
  });
});

describe("rows with no property", () => {
  const noProperty = { date: "03/05/2021", name: "Bank adjustment", amount: -78, property: "", category: "Admin & Other", sub: "Bank Fees" };

  it("in an all-properties export have no property, and do not create one called All Properties", () => {
    const ledger = readStessaSheet(sheet("General Ledger for All Properties", [row, noProperty]));
    expect(ledger.properties).toEqual(["1 Main St"]);
    expect(ledger.rows.find((r) => r.name === "Bank adjustment")!.property).toBe("");
  });

  it("in a one-property export still belong to that property", () => {
    const ledger = readStessaSheet(sheet("General Ledger for 1 Main St", [noProperty]));
    expect(ledger.rows[0].property).toBe("1 Main St");
    expect(ledger.properties).toEqual(["1 Main St"]);
  });
});

// Your real exports. Skipped when the files are not on this machine.
const PER_PROPERTY = "G:/My Drive/Corporation/Taxes/2021/Properties";
const FILES = [
  "126OrchardSprings/GeneralLedgerReport.xlsx",
  "1816TER/GeneralLedgerReport.xlsx",
  "HickoryRidge/GeneralLedgerReport.xlsx",
  "Kohout/GeneralLedgerReport.xlsx",
  "MapleHeights/GeneralLedgerReport (1).xlsx",
  "QueenJoanna/GeneralLedgerReport.xlsx",
  "ShadyOak/GeneralLedgerReport.xlsx",
  "Sparks/GeneralLedgerReport.xlsx",
];
const ALL = path.resolve(import.meta.dirname, "../data/GeneralLedgerForAllProperties20210128-20260930.xlsx");
const available = existsSync(ALL) && FILES.every((f) => existsSync(path.join(PER_PROPERTY, f)));

describe.skipIf(!available)("real all-properties export", () => {
  it("covers the properties and recognizes your already-imported 2021 rows as the same transactions", async () => {
    const all = await parseStessaLedger(ALL);
    expect(all.propertyName).toBe("All Properties");
    expect(all.properties.length).toBeGreaterThan(8);

    const allHashes = new Set(all.rows.map((r) => r.dedupeHash));
    let total = 0;
    let found = 0;
    for (const f of FILES) {
      const one = await parseStessaLedger(path.join(PER_PROPERTY, f));
      for (const r of one.rows) {
        total += 1;
        if (allHashes.has(r.dedupeHash)) found += 1;
      }
    }
    console.log(`all-properties file: ${all.rows.length} rows, ${all.properties.length} properties; ${found} of ${total} per-property rows found in it`);
    // Anything edited in Stessa since the per-property exports will differ, so allow a little.
    expect(found / total).toBeGreaterThan(0.9);
  });
});
