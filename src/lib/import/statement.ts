import Papa from "papaparse";

/** One transaction from a bank or card statement. Money in is positive, money out is negative. */
export interface StatementRow {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amountCents: number;
  /** The bank's own transaction id (OFX FITID), when there is one. */
  ref: string | null;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export type DateFormat = "auto" | "mdy" | "dmy" | "ymd";

export interface ColumnMapping {
  date: number;
  description: number;
  /** A single signed amount column, or null when debit and credit are separate columns. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  dateFormat: DateFormat;
  /** Reverse the sign (credit card statements often list charges as positive numbers). */
  flip: boolean;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Dollars-and-cents text to cents. Handles $, commas, (1,234.56) and 1,234.56- as negatives. Null if not a number. */
export function parseAmount(text: string | undefined | null): number | null {
  if (text === undefined || text === null) return null;
  let t = String(text).trim();
  if (t === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith("-")) {
    negative = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  }
  t = t.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return negative ? -cents : cents;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Text to an ISO date. "auto" reads 2021-03-05 as year first, and otherwise as month/day/year unless the first part is above 12. */
export function parseDate(text: string | undefined | null, format: DateFormat = "auto"): string | null {
  if (!text) return null;
  const t = String(text).trim().split(/[ T]/)[0];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return validDate(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const a = +m[1];
  const b = +m[2];
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const dayFirst = format === "dmy" || (format === "auto" && a > 12);
  return dayFirst ? validDate(year, b, a) : validDate(year, a, b);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parse CSV text. Banks often put a few lines of preamble above the header, so the header is the first row that mentions a date. */
export function parseCsvText(text: string): CsvTable {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const all = (parsed.data as string[][]).map((r) => r.map((c) => String(c ?? "").trim()));
  if (all.length === 0) return { headers: [], rows: [] };

  const headerIndex = Math.max(
    0,
    all.findIndex((r) => r.filter((c) => c !== "").length >= 2 && r.some((c) => /date/i.test(c))),
  );
  const headers = all[headerIndex];
  const width = headers.length;
  const rows = all.slice(headerIndex + 1).map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...new Array(width - r.length).fill("")]));
  return { headers, rows };
}

const find = (headers: string[], test: RegExp, skip: (h: string) => boolean = () => false) =>
  headers.findIndex((h) => test.test(h) && !skip(h));

/** Guess which column is which from the header names. */
export function detectMapping(table: CsvTable): ColumnMapping {
  const h = table.headers;
  const notBalance = (x: string) => /balance/i.test(x);

  let date = find(h, /^(transaction |trans\.? |posting |post |posted )?date$/i);
  if (date < 0) date = find(h, /date/i, (x) => /due|settle|value/i.test(x));

  let description = find(h, /^(description|payee|merchant|name|details|memo|narrative|transaction description)$/i);
  if (description < 0) description = find(h, /desc|payee|memo|name|detail|narrative|merchant/i);

  const debit = find(h, /debit|withdraw|paid out|money out|payment/i, notBalance);
  const credit = find(h, /credit|deposit|paid in|money in/i, notBalance);
  let amount = find(h, /^amount$/i);
  if (amount < 0) amount = find(h, /amount/i, (x) => notBalance(x) || /debit|credit/i.test(x));

  const split = amount < 0 && debit >= 0 && credit >= 0;
  return {
    date: Math.max(date, 0),
    description: description >= 0 ? description : Math.min(1, Math.max(0, h.length - 1)),
    amount: split ? null : amount >= 0 ? amount : null,
    debit: split ? debit : null,
    credit: split ? credit : null,
    dateFormat: "auto",
    flip: false,
  };
}

/** True when most amounts are positive: a sign that charges are listed as positive (a credit card statement). */
export function looksLikeChargesArePositive(table: CsvTable, mapping: ColumnMapping): boolean {
  if (mapping.amount === null) return false;
  const values = table.rows.map((r) => parseAmount(r[mapping.amount!])).filter((v): v is number => v !== null && v !== 0);
  if (values.length < 5) return false;
  return values.filter((v) => v > 0).length / values.length > 0.8;
}

export interface ParsedStatement {
  rows: StatementRow[];
  skipped: number;
}

/** Turn mapped CSV rows into transactions. Rows without a valid date or amount (totals, footers) are skipped. */
export function rowsFromCsv(table: CsvTable, m: ColumnMapping): ParsedStatement {
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const r of table.rows) {
    const date = parseDate(r[m.date], m.dateFormat);
    let cents: number | null;
    if (m.amount !== null) {
      cents = parseAmount(r[m.amount]);
    } else {
      const debit = m.debit !== null ? parseAmount(r[m.debit]) : null;
      const credit = m.credit !== null ? parseAmount(r[m.credit]) : null;
      cents = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date || cents === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      date,
      description: (r[m.description] ?? "").replace(/\s+/g, " ").trim() || "(no description)",
      amountCents: m.flip ? -cents : cents,
      ref: null,
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// OFX / QFX
// ---------------------------------------------------------------------------

export function looksLikeOfx(text: string) {
  return /<OFX>|OFXHEADER:/i.test(text.slice(0, 2000)) || /<STMTTRN>/i.test(text);
}

/** Parse OFX or QFX. Handles both the older SGML style (no closing tags) and XML style. */
export function parseOfx(text: string): ParsedStatement {
  const rows: StatementRow[] = [];
  let skipped = 0;
  const block = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRNRS>|$)/gi;
  const field = (b: string, tag: string) => new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(b)?.[1].trim() ?? "";

  for (const m of text.matchAll(block)) {
    const b = m[1];
    const posted = /^(\d{4})(\d{2})(\d{2})/.exec(field(b, "DTPOSTED"));
    const date = posted ? validDate(+posted[1], +posted[2], +posted[3]) : null;
    const cents = parseAmount(field(b, "TRNAMT"));
    if (!date || cents === null) {
      skipped += 1;
      continue;
    }
    const name = field(b, "NAME");
    const memo = field(b, "MEMO");
    const description = [name, memo && memo !== name ? memo : ""].filter(Boolean).join(" - ").replace(/\s+/g, " ").trim();
    rows.push({ date, description: description || "(no description)", amountCents: cents, ref: field(b, "FITID") || null });
  }
  return { rows, skipped };
}
