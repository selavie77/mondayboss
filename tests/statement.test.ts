import { describe, it, expect } from "vitest";
import {
  detectMapping,
  looksLikeChargesArePositive,
  looksLikeOfx,
  parseAmount,
  parseCsvText,
  parseDate,
  parseOfx,
  rowsFromCsv,
} from "@/lib/import/statement";

describe("amounts", () => {
  it("reads dollars and cents without float drift", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("$19.99")).toBe(1999);
    expect(parseAmount("0.1")).toBe(10);
    expect(parseAmount("100")).toBe(10000);
  });

  it("reads negatives written as -5, (5), and 5-", () => {
    expect(parseAmount("-45.10")).toBe(-4510);
    expect(parseAmount("(45.10)")).toBe(-4510);
    expect(parseAmount("45.10-")).toBe(-4510);
    expect(parseAmount("-$3.00")).toBe(-300);
  });

  it("returns null for blanks and words", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("Total")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe("dates", () => {
  it("reads common formats", () => {
    expect(parseDate("2021-03-05")).toBe("2021-03-05");
    expect(parseDate("03/05/2021")).toBe("2021-03-05");
    expect(parseDate("3/5/21")).toBe("2021-03-05");
    expect(parseDate("2021/03/05 14:20")).toBe("2021-03-05");
  });

  it("auto-detects day-first when the first part is above 12, or when told to", () => {
    expect(parseDate("25/12/2021")).toBe("2021-12-25");
    expect(parseDate("05/03/2021", "dmy")).toBe("2021-03-05");
    expect(parseDate("05/03/2021", "mdy")).toBe("2021-05-03");
  });

  it("rejects impossible dates", () => {
    expect(parseDate("02/30/2021")).toBeNull();
    expect(parseDate("13/13/2021")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("CSV statements", () => {
  const bank = [
    "Date,Description,Amount,Balance",
    "01/04/2021,RENT DEPOSIT KNIGHT,1050.00,5050.00",
    "01/05/2021,\"HOME DEPOT, #123\",-84.17,4965.83",
    "01/06/2021,WATER BILL,(26.22),4939.61",
    ",Total,,",
  ].join("\n");

  it("detects the columns and reads the rows, skipping footers", () => {
    const table = parseCsvText(bank);
    const mapping = detectMapping(table);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2, debit: null, credit: null });
    const { rows, skipped } = rowsFromCsv(table, mapping);
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { date: "2021-01-04", description: "RENT DEPOSIT KNIGHT", amountCents: 105000, ref: null },
      { date: "2021-01-05", description: "HOME DEPOT, #123", amountCents: -8417, ref: null },
      { date: "2021-01-06", description: "WATER BILL", amountCents: -2622, ref: null },
    ]);
  });

  it("skips preamble lines above the header", () => {
    const text = ["Account Activity for Checking ...6134", "Generated 02/01/2021", "", "Posting Date,Details,Amount", "01/04/2021,Rent,100.00"].join("\n");
    const table = parseCsvText(text);
    expect(table.headers).toEqual(["Posting Date", "Details", "Amount"]);
    expect(rowsFromCsv(table, detectMapping(table)).rows).toHaveLength(1);
  });

  it("handles separate debit and credit columns (money in is credit)", () => {
    const text = ["Date,Description,Debit,Credit", "01/04/2021,Rent,,1050.00", "01/05/2021,Hardware,84.17,"].join("\n");
    const table = parseCsvText(text);
    const mapping = detectMapping(table);
    expect(mapping).toMatchObject({ amount: null, debit: 2, credit: 3 });
    expect(rowsFromCsv(table, mapping).rows.map((r) => r.amountCents)).toEqual([105000, -8417]);
  });

  it("can flip the sign for credit cards that list charges as positive", () => {
    const text = [
      "Transaction Date,Description,Amount",
      ...Array.from({ length: 6 }, (_, i) => `01/0${i + 1}/2021,Charge ${i},${10 + i}.00`),
      "01/09/2021,Payment,-100.00",
    ].join("\n");
    const table = parseCsvText(text);
    const mapping = detectMapping(table);
    expect(looksLikeChargesArePositive(table, mapping)).toBe(true);
    const flipped = rowsFromCsv(table, { ...mapping, flip: true }).rows;
    expect(flipped[0].amountCents).toBe(-1000); // a charge is money out
    expect(flipped.at(-1)!.amountCents).toBe(10000); // a payment is money in
  });

  it("does not suggest flipping a normal mixed statement", () => {
    const table = parseCsvText(bank);
    expect(looksLikeChargesArePositive(table, detectMapping(table))).toBe(false);
  });
});

describe("OFX statements", () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20210104120000[0:GMT]
<TRNAMT>1050.00
<FITID>2021010401
<NAME>RENT DEPOSIT
<MEMO>KNIGHT WILKINS
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20210105
<TRNAMT>-84.17
<FITID>2021010502
<NAME>HOME DEPOT
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("recognizes OFX text", () => {
    expect(looksLikeOfx(sgml)).toBe(true);
    expect(looksLikeOfx("Date,Description,Amount")).toBe(false);
  });

  it("reads SGML-style transactions with ids, names and memos", () => {
    const { rows } = parseOfx(sgml);
    expect(rows).toEqual([
      { date: "2021-01-04", description: "RENT DEPOSIT - KNIGHT WILKINS", amountCents: 105000, ref: "2021010401" },
      { date: "2021-01-05", description: "HOME DEPOT", amountCents: -8417, ref: "2021010502" },
    ]);
  });

  it("reads XML-style transactions too", () => {
    const xml = "<OFX><STMTTRN><DTPOSTED>20210110</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>a1</FITID><NAME>COFFEE</NAME></STMTTRN></OFX>";
    expect(parseOfx(xml).rows).toEqual([{ date: "2021-01-10", description: "COFFEE", amountCents: -1250, ref: "a1" }]);
  });
});
