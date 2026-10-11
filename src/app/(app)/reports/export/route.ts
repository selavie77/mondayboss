import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { loadAccountTransactions, loadCapex, loadLedger, loadReport } from "@/lib/reports/load";
import { parseParams } from "@/lib/reports/params";

type Cell = string | number | null;
interface Sheet {
  title: string;
  subtitle: string;
  header: string[];
  rows: { cells: Cell[]; style: "heading" | "plain" | "total" | "grand" | "gap"; ratio?: boolean }[];
  /** Columns holding dollar amounts. Others are text. */
  moneyFrom: number;
}

const csvEscape = (v: Cell) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: NextRequest) {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseParams(sp, new Date().getFullYear());
  const format = sp.format === "csv" ? "csv" : "xlsx";

  let sheet: Sheet;
  if (params.report === "capital-expenses") {
    const c = await loadCapex(params);
    sheet = {
      title: c.title,
      subtitle: c.subtitle,
      header: ["Date", "Name", "Type", "Amount", "Placed in service", "Useful life (years)", "Property", "Portfolio", "Notes", "Source"],
      moneyFrom: 3,
      rows: [
        ...c.rows.map((r) => ({
          style: "plain" as const,
          cells: [r.spentOn, r.name, r.subCategory, r.amountCents / 100, r.placedInService, r.usefulLife, r.property, r.portfolio, r.notes, r.source === "books" ? "In your books" : "Added by hand"] as Cell[],
        })),
        { style: "grand", cells: ["TOTAL CAPITAL EXPENSES", null, null, c.rows.reduce((s, r) => s + r.amountCents, 0) / 100] },
      ],
    };
  } else if (params.report === "account-transactions") {
    const t = await loadAccountTransactions(params);
    const rows: Sheet["rows"] = [];
    for (const e of t.entries) {
      e.lines.forEach((l, i) => {
        rows.push({
          style: "plain",
          cells: [i === 0 ? e.date : null, i === 0 ? e.description : null, `${l.code}  ${l.account}`, i === 0 ? e.type : null, l.property, l.debitCents ? l.debitCents / 100 : null, l.creditCents ? l.creditCents / 100 : null],
        });
      });
    }
    rows.push({ style: "grand", cells: ["TOTAL", null, null, null, null, t.totalDebitsCents / 100, t.totalCreditsCents / 100] });
    sheet = { title: t.title, subtitle: t.subtitle, header: ["Date", "Transaction", "Account", "Type", "Property", "Debit", "Credit"], moneyFrom: 5, rows };
  } else if (params.report === "general-ledger") {
    const g = await loadLedger(params);
    const rows: Sheet["rows"] = [];
    for (const grp of g.groups) {
      rows.push({ style: "heading", cells: [`${grp.account.code}  ${grp.account.parentName ? `${grp.account.parentName} › ` : ""}${grp.account.name}`] });
      rows.push({ style: "plain", cells: [null, "Opening balance", null, null, null, grp.openingCents / 100] });
      for (const e of grp.entries) {
        rows.push({
          style: "plain",
          cells: [e.date, e.description, e.property, e.debitCents ? e.debitCents / 100 : null, e.creditCents ? e.creditCents / 100 : null, e.balanceCents / 100],
        });
      }
      rows.push({ style: "total", cells: [null, "Closing balance", null, grp.debitsCents / 100, grp.creditsCents / 100, grp.closingCents / 100] });
    }
    sheet = { title: g.title, subtitle: g.subtitle, header: ["Date", "Description", "Property", "Debit", "Credit", "Balance"], moneyFrom: 3, rows };
  } else {
    const r = await loadReport(params);
    sheet = {
      title: r.title,
      subtitle: r.subtitle,
      header: ["", ...r.columns],
      moneyFrom: 1,
      rows: r.rows.map((row) => ({
        style: row.kind === "heading" ? "heading" : row.kind === "gap" ? "gap" : row.kind === "grand" ? "grand" : row.kind === "total" ? "total" : "plain",
        ratio: row.kind === "ratio",
        cells: [
          row.kind === "subline" ? `    ${row.label}` : row.label,
          ...(row.values ?? []).map((v) => (v === null || v === undefined ? null : row.kind === "ratio" ? Math.round(v * 100) / 100 : v / 100)),
        ],
      })),
    };
  }

  const filename = `${sheet.title.replace(/[^\w]+/g, "-").replace(/-+$/g, "")}.${format}`;

  if (format === "csv") {
    const lines = [
      [sheet.title],
      [sheet.subtitle],
      [],
      sheet.header,
      ...sheet.rows.filter((r) => r.style !== "gap").map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : c))),
    ];
    return new Response(lines.map((l) => l.map(csvEscape).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow([sheet.title]).font = { bold: true, size: 14 };
  ws.addRow([sheet.subtitle]).font = { color: { argb: "FF5D706E" } };
  ws.addRow([]);
  const header = ws.addRow(sheet.header);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECF8F6" } };
    c.border = { bottom: { style: "thin" } };
  });

  const money = params.cents || params.report === "capital-expenses" || params.report === "general-ledger" || params.report === "account-transactions" ? '#,##0.00;(#,##0.00);"–"' : '#,##0;(#,##0);"–"';
  for (const r of sheet.rows) {
    const row = ws.addRow(r.cells);
    if (r.style === "heading") row.font = { bold: true, color: { argb: "FF145F5A" } };
    if (r.style === "total" || r.style === "grand") {
      row.font = { bold: true };
      row.eachCell({ includeEmpty: true }, (c) => (c.border = { top: { style: "thin" } }));
    }
    r.cells.forEach((v, i) => {
      if (typeof v === "number" && i >= sheet.moneyFrom) row.getCell(i + 1).numFmt = r.ratio ? '0.00"x"' : money;
    });
  }

  ws.getColumn(1).width = sheet.moneyFrom === 1 ? 40 : 14;
  for (let i = 2; i <= sheet.header.length; i++) ws.getColumn(i).width = sheet.moneyFrom === 1 ? 18 : 22;
  ws.views = [{ state: "frozen", xSplit: sheet.moneyFrom === 1 ? 1 : 0, ySplit: 4 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
