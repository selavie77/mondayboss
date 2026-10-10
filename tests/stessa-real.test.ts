import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { parseStessaLedger } from "@/lib/import/stessa";
import { planStessaImport, type ImportPlan } from "@/lib/import/stessaEntries";
import { formatCents } from "@/lib/money";
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
});
