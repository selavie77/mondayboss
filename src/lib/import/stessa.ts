import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { toCents } from "@/lib/money";

export interface StessaRow {
  date: string; // ISO yyyy-mm-dd
  name: string;
  notes: string;
  details: string;
  category: string | null;
  subCategory: string | null;
  amountCents: number; // signed: money in positive, money out negative
  property: string;
  /** Stessa's Portfolio column. */
  portfolio: string;
  source: string;
  account: string;
  dedupeHash: string;
}

export interface StessaLedger {
  /** From the title: a property name, or "All Properties" for a whole-portfolio export. */
  propertyName: string;
  /** The distinct properties the rows belong to. */
  properties: string[];
  rows: StessaRow[];
  skippedRows: number; // blank / footer rows
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/^﻿/, "").trim();
}

/** Parse a Stessa "General Ledger" xlsx export (one property per file). */
export async function parseStessaLedger(path: string): Promise<StessaLedger> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return readStessaSheet(wb.worksheets[0]);
}

/** Parse an uploaded Stessa "General Ledger" xlsx. Throws a readable error for anything else. */
export async function parseStessaBuffer(buffer: Buffer): Promise<StessaLedger> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error("This file could not be read as an Excel workbook.");
  }
  const ws = wb.worksheets[0];
  if (!ws || !/^General Ledger for\s+/i.test(text(ws.getRow(2).getCell(1).value))) {
    throw new Error("This doesn't look like a Stessa General Ledger export.");
  }
  return readStessaSheet(ws);
}

export function readStessaSheet(ws: ExcelJS.Worksheet): StessaLedger {
  const title = text(ws.getRow(2).getCell(1).value);
  const propertyName = title.replace(/^General Ledger for\s+/i, "").trim();

  const rows: StessaRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 5) return;
    const cell = (i: number) => text(row.getCell(i).value);
    const m = DATE_RE.exec(cell(2));
    if (!m) {
      skipped += 1;
      return;
    }
    const rawAmount = row.getCell(8).value;
    if (rawAmount === null || rawAmount === undefined || rawAmount === "") {
      skipped += 1;
      return;
    }
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    const amountCents = toCents(Number(rawAmount));

    // The row's own property (not the file title), so the same transaction has the same fingerprint
    // whether it came from a one-property file or an all-properties file.
    // A one-property file's title names the property. In an all-properties export a row with no property
    // really has none, so it must not inherit the title ("All Properties") as if it were a property.
    const rowProperty = cell(10) || (/^all properties$/i.test(propertyName) ? "" : propertyName);

    // Identical rows (same rent every month) are legitimate, so number the repeats.
    const base = [rowProperty, date, cell(3), cell(4), cell(5), cell(6), cell(7), amountCents].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);

    rows.push({
      date,
      name: cell(3),
      notes: cell(4),
      details: cell(5),
      category: cell(6) || null,
      subCategory: cell(7) || null,
      amountCents,
      property: rowProperty,
      portfolio: cell(9),
      source: cell(12),
      account: cell(13),
      dedupeHash: createHash("sha1").update(`${base}|${n}`).digest("hex"),
    });
  });

  return { propertyName, properties: [...new Set(rows.map((r) => r.property).filter(Boolean))], rows, skippedRows: skipped };
}
