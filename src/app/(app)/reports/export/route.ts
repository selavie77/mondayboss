import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { loadCapex, loadReport } from "@/lib/reports/load";
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
      header: ["Date", "Name", "Type", "Amount", "Placed in service", "Useful life (years)", "Property", "Portfolio", "Notes"],
      moneyFrom: 3,
      rows: [
        ...c.rows.map((r) => ({
          style: "plain" as const,
          cells: [r.spentOn, r.name, r.subCategory, r.amountCents / 100, r.placedInService, r.usefulLife, r.property, r.portfolio, r.notes] as Cell[],
        })),
        { style: "grand", cells: ["TOTAL CAPITAL EXPENSES", null, null, c.rows.reduce((s, r) => s + r.amountCents, 0) / 100] },
      ],
    };
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

  const money = params.cents || params.report === "capital-expenses" ? '#,##0.00;(#,##0.00);"–"' : '#,##0;(#,##0);"–"';
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
