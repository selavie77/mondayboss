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
  source: string;
  account: string;
  dedupeHash: string;
}

export interface StessaLedger {
  propertyName: string;
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

    // Identical rows (same rent every month) are legitimate, so number the repeats.
    const base = [propertyName, date, cell(3), cell(4), cell(5), cell(6), cell(7), amountCents].join("|");
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
      property: cell(10) || propertyName,
      source: cell(12),
      account: cell(13),
      dedupeHash: createHash("sha1").update(`${base}|${n}`).digest("hex"),
    });
  });

  return { propertyName, rows, skippedRows: skipped };
}
