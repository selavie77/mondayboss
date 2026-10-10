import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { parseStessaLedger } from "@/lib/import/stessa";
import { planStessaImport, type ImportPlan } from "@/lib/import/stessaEntries";
import { formatCents } from "@/lib/money";
import { buildBalanceSheet, buildIncomeStatement, buildNetCashFlow, buildTrialBalance } from "@/lib/reports/build";
import { buildLedger } from "@/lib/reports/ledger";
import type { AccountInfo, ActivityRow, ReportData } from "@/lib/reports/types";
import { freshDb, seedEntity } from "./db";

// Your real 2021 Stessa exports. The test is skipped on machines that don't have them.
const BASE = "G:/My Drive/Corporation/Taxes/2021/Properties";
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
const available = FILES.every((f) => existsSync(path.join(BASE, f)));

describe.skipIf(!available)("real Stessa 2021 ledgers", () => {
  let db: PGlite;
  let plan: ImportPlan;
  let rowCount = 0;

  beforeAll(async () => {
    const ledgers = await Promise.all(FILES.map((f) => parseStessaLedger(path.join(BASE, f))));
    rowCount = ledgers.reduce((s, l) => s + l.rows.length, 0);
    plan = planStessaImport(ledgers);

    db = await freshDb();
    const s = await seedEntity(db);
    const accountIds = new Map<string, string>();
    const posting = [...plan.entries, ...plan.review]; // review rows are posted here only to total the P&L
    for (const key of new Set(posting.flatMap((e) => e.lines.map((l) => l.accountCode)))) {
      const [code, sub] = key.split("::");
      if (!sub) {
        accountIds.set(key, await s.acct(code));
      } else {
        const made = await db.query<{ id: string }>(`select ensure_subaccount($1, $2) as id`, [await s.acct(code), sub]);
        accountIds.set(key, made.rows[0].id);
      }
    }
    const propIds = new Map<string, string>();
    for (const l of ledgers) {
      const r = await db.query<{ id: string }>(
        `insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1,$2,$3,$4) returning id`,
        [s.ws, s.pf, s.ent, l.propertyName]);
      propIds.set(l.propertyName, r.rows[0].id);
    }
    for (const e of posting) {
      const lines = e.lines.map((l) => ({
        account_id: accountIds.get(l.accountCode),
        property_id: propIds.get(l.property),
        debit_cents: l.debitCents,
        credit_cents: l.creditCents,
      }));
      await db.query(`select post_entry($1, $2::date, $3, $4::jsonb, 'import')`, [s.ent, e.date, e.memo, JSON.stringify(lines)]);
    }
  });

  it("parses every transaction and posts balanced entries", async () => {
    expect(rowCount).toBe(plan.entries.length + plan.review.length + plan.unresolved.length);
    const tb = await db.query(`select sum(debit_cents)::bigint d, sum(credit_cents)::bigint c from trial_balance`);
    const r = tb.rows[0] as { d: bigint | number; c: bigint | number };
    expect(Number(r.d)).toBe(Number(r.c));
  });

  it("reports a Schedule E style summary and the unresolved items", async () => {
    const pnl = await db.query(
      `select coalesce(tax_line,'(none)') line, category_name as name, sum(amount_cents)::bigint amt
         from property_pnl_monthly group by tax_line, category_name order by tax_line, category_name`);
    const lines = (pnl.rows as { line: string; name: string; amt: bigint | number }[])
      .map((r) => `${r.line.padEnd(34)} ${r.name.padEnd(28)} ${formatCents(Number(r.amt)).padStart(12)}`);
    const byReason = new Map<string, number>();
    for (const u of plan.unresolved) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
    const review = new Map<string, number>();
    for (const e of plan.review) for (const w of e.warnings) review.set(w, (review.get(w) ?? 0) + 1);

    console.log(["\n=== P&L by Schedule E line (all 8 properties, 2021) ===", ...lines,
      "\n=== Unresolved (not posted) ===", ...[...byReason].map(([k, v]) => `${v} x ${k}`),
      "\n=== Posted but flagged for review ===", ...[...review].map(([k, v]) => `${v} x ${k}`),
      `\nposted ${plan.entries.length} entries, unresolved ${plan.unresolved.length}`].join("\n"));
    expect(plan.entries.length).toBeGreaterThan(500);
    expect(plan.review.length).toBeGreaterThan(0);
  });

  it("reproduces Stessa's 2021 Income Statement and Net Cash Flow for 126 E Orchard Springs", async () => {
    const props = (await db.query<{ id: string; name: string }>(`select id, name from properties order by name`)).rows;
    const accts = (await db.query<{ id: string; parent_id: string | null; code: string; name: string; type: AccountInfo["type"]; subtype: string | null; is_bank: boolean }>(
      `select id, parent_id, code, name, type, subtype, is_bank from accounts`)).rows;
    const accounts: AccountInfo[] = accts.map((a) => ({ id: a.id, parentId: a.parent_id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, isBank: a.is_bank }));
    const act = (await db.query<{ property_id: string | null; account_id: string; net_cents: string | number }>(
      `select property_id, account_id, net_cents from report_activity('2021-01-01', '2021-12-31', 'property')`)).rows;
    const activity: ActivityRow[] = act.map((r) => ({ columnKey: r.property_id ?? "unassigned", accountId: r.account_id, netCents: Number(r.net_cents) }));
    const columns = props.map((p) => ({ key: p.id, label: p.name }));
    const orchard = props.findIndex((p) => p.name === "126 E Orchard Springs Dr");
    const input = { accounts, activity, columns, subtitle: "", options: { detail: "sub" as const, showTotal: true } };

    // Stessa shows whole dollars, so compare in whole dollars.
    const dollars = (r: ReportData, label: string) => Math.round(r.rows.find((x) => x.label === label)!.values![orchard]! / 100);

    const is = buildIncomeStatement(input);
    expect(dollars(is, "TOTAL INCOME")).toBe(11550);
    expect(dollars(is, "General Management Fees")).toBe(257);
    expect(dollars(is, "Property Management")).toBe(756);
    expect(dollars(is, "Total Management Fees")).toBe(1013);
    expect(dollars(is, "Total Utilities")).toBe(315);
    expect(dollars(is, "Total Repairs")).toBe(1496);
    expect(dollars(is, "TOTAL OPERATING EXPENSES")).toBe(2853);
    expect(dollars(is, "NET OPERATING INCOME")).toBe(8697);

    const cf = buildNetCashFlow(input);
    expect(dollars(cf, "Interest")).toBe(3057);
    expect(dollars(cf, "Principal")).toBe(1074);
    expect(dollars(cf, "NET CASH FLOW")).toBe(4566);
    expect(dollars(cf, "NCF Before Principal Payments")).toBe(5640);
    expect(dollars(cf, "TOTAL TRANSFERS")).toBe(-2850);

    // The books themselves: net change in cash must equal the movement in the cash account, for every property.
    const cash = await db.query<{ property_id: string; net: string | number }>(
      `select l.property_id, sum(l.debit_cents - l.credit_cents) net
         from journal_lines l join accounts a on a.id = l.account_id where a.is_bank group by 1`);
    const change = cf.rows.find((x) => x.label === "NET CHANGE IN CASH")!.values!;
    for (const c of cash.rows) {
      const i = props.findIndex((p) => p.id === c.property_id);
      expect(change[i]).toBe(Number(c.net));
    }
  });
  it("the trial balance, balance sheet and general ledger agree with each other", async () => {
    const accts = (await db.query<{ id: string; parent_id: string | null; code: string; name: string; type: AccountInfo["type"]; subtype: string | null; is_bank: boolean }>(
      `select id, parent_id, code, name, type, subtype, is_bank from accounts`)).rows;
    const accounts: AccountInfo[] = accts.map((a) => ({ id: a.id, parentId: a.parent_id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, isBank: a.is_bank }));
    const act = (await db.query<{ account_id: string; net_cents: string | number }>(
      `select account_id, net_cents from report_activity('1900-01-01', '2021-12-31', 'total')`)).rows;
    const activity: ActivityRow[] = act.map((r) => ({ columnKey: "all", accountId: r.account_id, netCents: Number(r.net_cents) }));
    const input = { accounts, activity, columns: [{ key: "all", label: "Total" }], subtitle: "", options: { detail: "sub" as const, showTotal: false } };

    // Trial balance: every cent of debit has a matching credit.
    const tb = buildTrialBalance(input);
    const total = tb.rows.find((r) => r.label === "TOTAL")!.values!;
    expect(total[0]).toBe(total[1]);
    expect(tb.notes?.[0].tone).toBe("ok");

    // Balance sheet: assets = liabilities + equity (including profit to date).
    const bs = buildBalanceSheet(input);
    const val = (label: string) => bs.rows.find((r) => r.label === label)!.values![0]!;
    expect(val("TOTAL ASSETS")).toBe(val("TOTAL LIABILITIES & EQUITY"));
    expect(bs.notes?.[0].tone).toBe("ok");

    // General ledger: each account's closing balance equals its trial-balance balance (natural direction).
    const lines = (await db.query<{ account_id: string; d: string | number; c: string | number; date: string; created: string; id: string }>(
      `select l.account_id, l.debit_cents d, l.credit_cents c, to_char(e.entry_date, 'YYYY-MM-DD') as date, e.created_at::text created, l.id
         from journal_lines l join journal_entries e on e.id = l.entry_id`)).rows;
    const ledgerAccounts = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, parentName: null }));
    const groups = buildLedger(
      ledgerAccounts,
      lines.map((l) => ({ accountId: l.account_id, date: l.date, order: `${l.created}|${l.id}`, description: "", property: "", debitCents: Number(l.d), creditCents: Number(l.c) })),
      new Map(),
    );
    for (const g of groups) {
      const net = Number(act.find((r) => r.account_id === g.account.id)?.net_cents ?? 0);
      const natural = g.account.type === "asset" || g.account.type === "expense" ? net : -net;
      expect(g.closingCents).toBe(natural);
    }
    expect(groups.length).toBeGreaterThan(5);
  });
});
