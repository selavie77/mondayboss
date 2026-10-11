import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, seedEntity } from "./db";

let db: PGlite;
let s: Awaited<ReturnType<typeof seedEntity>>;

beforeAll(async () => {
  db = await freshDb();
  s = await seedEntity(db);
});

async function business(name: string) {
  const ent = (await db.query<{ id: string }>(`insert into entities (workspace_id, name) values ($1, $2) returning id`, [s.ws, name])).rows[0].id;
  await db.query(`select seed_default_chart($1)`, [ent]);
  const acct = async (code: string) => (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = $2`, [ent, code])).rows[0].id;
  const post = async (date: string, memo: string, lines: object[]) =>
    (await db.query<{ id: string }>(`select post_entry($1, $2::date, $3, $4::jsonb) as id`, [ent, date, memo, JSON.stringify(lines)])).rows[0].id;
  return { ent, acct, post };
}

describe("bank reconciliation", () => {
  it("ticks lines off until the statement agrees, one period after another, and can be undone", async () => {
    const b = await business("Rec LLC");
    const cash = await b.acct("1000");
    const rent = await b.acct("4000");
    const repairs = await b.acct("5090");
    await b.post("2036-01-05", "Rent", [{ account_id: cash, debit_cents: 100000 }, { account_id: rent, credit_cents: 100000 }]);
    await b.post("2036-01-10", "Plumber", [{ account_id: repairs, debit_cents: 30000 }, { account_id: cash, credit_cents: 30000 }]);
    await b.post("2036-02-03", "Rent", [{ account_id: cash, debit_cents: 50000 }, { account_id: rent, credit_cents: 50000 }]);

    const open = async (through: string) =>
      (await db.query(`select line_id, memo, debit_cents::int d, credit_cents::int c, other_accounts from unreconciled_lines($1, $2)`, [cash, through])).rows as {
        line_id: string;
        memo: string;
        d: number;
        c: number;
        other_accounts: string;
      }[];

    const jan = await open("2036-01-31");
    expect(jan.map((l) => [l.memo, l.d, l.c, l.other_accounts])).toEqual([
      ["Rent", 100000, 0, "Rental Income"],
      ["Plumber", 0, 30000, "Repairs"],
    ]);

    // A wrong ending balance is refused, and says by how much.
    await expect(db.query(`select complete_reconciliation($1, '2036-01-31'::date, 80000, $2::uuid[])`, [cash, jan.map((l) => l.line_id)])).rejects.toThrow(/difference is 100\.00/);

    const rec1 = (await db.query<{ id: string }>(`select complete_reconciliation($1, '2036-01-31'::date, 70000, $2::uuid[]) as id`, [cash, jan.map((l) => l.line_id)])).rows[0].id;
    expect(Number((await db.query<{ b: string }>(`select reconciled_balance($1) b`, [cash])).rows[0].b)).toBe(70000);
    expect(await open("2036-01-31")).toEqual([]);

    // The same period, or an earlier one, cannot be reconciled again.
    const feb = await open("2036-02-28");
    expect(feb.map((l) => l.memo)).toEqual(["Rent"]);
    await expect(db.query(`select complete_reconciliation($1, '2036-01-31'::date, 120000, $2::uuid[])`, [cash, feb.map((l) => l.line_id)])).rejects.toThrow(/already reconciled through/);

    // A line cannot be ticked twice.
    await expect(db.query(`select complete_reconciliation($1, '2036-02-28'::date, 120000, $2::uuid[])`, [cash, [jan[0].line_id, ...feb.map((l) => l.line_id)]])).rejects.toThrow(/not available/);

    const rec2 = (await db.query<{ id: string }>(`select complete_reconciliation($1, '2036-02-28'::date, 120000, $2::uuid[]) as id`, [cash, feb.map((l) => l.line_id)])).rows[0].id;

    // Only the latest can be undone.
    await expect(db.query(`select undo_reconciliation($1)`, [rec1])).rejects.toThrow(/Only the latest/);
    await db.query(`select undo_reconciliation($1)`, [rec2]);
    expect((await open("2036-02-28")).map((l) => l.memo)).toEqual(["Rent"]);
    await db.query(`select undo_reconciliation($1)`, [rec1]);
    expect((await open("2036-02-28")).length).toBe(3);
  });

  it("reads a credit card in its own direction: what is owed", async () => {
    const b = await business("Card LLC");
    const card = await b.acct("2200");
    const repairs = await b.acct("5090");
    await b.post("2036-03-05", "Hardware store", [{ account_id: repairs, debit_cents: 20000 }, { account_id: card, credit_cents: 20000 }]);
    const lines = (await db.query(`select line_id from unreconciled_lines($1, '2036-03-31')`, [card])).rows as { line_id: string }[];
    await db.query(`select complete_reconciliation($1, '2036-03-31'::date, 20000, $2::uuid[])`, [card, lines.map((l) => l.line_id)]);
    expect(Number((await db.query<{ b: string }>(`select reconciled_balance($1) b`, [card])).rows[0].b)).toBe(20000);
  });
});

describe("undoing an import", () => {
  async function importOf(name: string) {
    const b = await business(name);
    const batch = (await db.query<{ id: string }>(`insert into import_batches (workspace_id, entity_id, source, row_count) values ($1, $2, 'test', 3) returning id`, [s.ws, b.ent])).rows[0].id;
    const cash = await b.acct("1000");
    const repairs = await b.acct("5090");
    const line = async (n: number, date: string, cents: number) =>
      (
        await db.query<{ id: string }>(
          `insert into statement_lines (workspace_id, entity_id, batch_id, account_id, txn_date, description, amount_cents, dedupe_hash) values ($1, $2, $3, $4, $5::date, $6, $7, $8) returning id`,
          [s.ws, b.ent, batch, cash, date, `Row ${n}`, cents, `${name}-${n}`],
        )
      ).rows[0].id;
    const post = (id: string, cents: number) => db.query(`select post_statement_line($1, $2::jsonb)`, [id, JSON.stringify([{ account_id: repairs, debit_cents: cents }, { account_id: cash, credit_cents: cents }])]);
    return { ...b, batch, cash, line, post };
  }

  it("reverses what was posted, removes what waits in Review, and works in steps", async () => {
    const t = await importOf("Undo LLC");
    await t.post(await t.line(1, "2037-01-05", -1000), 1000);
    await t.post(await t.line(2, "2037-01-06", -2000), 2000);
    await t.line(3, "2037-01-07", -3000); // still pending

    const step = async (limit: number) =>
      (await db.query(`select reversed, remaining, done from undo_import_batch($1, $2)`, [t.batch, limit])).rows[0] as { reversed: number; remaining: number; done: boolean };
    expect(await step(1)).toEqual({ reversed: 1, remaining: 1, done: false });
    expect(await step(1)).toEqual({ reversed: 1, remaining: 0, done: true });

    // Cash and repairs are back to zero; the history keeps both the entries and their reversals.
    const net = (
      await db.query(
        `select a.code, (sum(l.debit_cents) - sum(l.credit_cents))::int n from journal_lines l join accounts a on a.id = l.account_id where l.entity_id = $1 and a.code in ('1000', '5090') group by a.code order by a.code`,
        [t.ent],
      )
    ).rows;
    expect(net).toEqual([{ code: "1000", n: 0 }, { code: "5090", n: 0 }]);
    expect(Number((await db.query<{ n: string }>(`select count(*) n from journal_entries where entity_id = $1`, [t.ent])).rows[0].n)).toBe(4);
    expect(Number((await db.query<{ n: string }>(`select count(*) n from statement_lines where batch_id = $1`, [t.batch])).rows[0].n)).toBe(0);
    expect((await db.query(`select undone_at is not null as undone from import_batches where id = $1`, [t.batch])).rows[0]).toEqual({ undone: true });
    await expect(db.query(`select * from undo_import_batch($1)`, [t.batch])).rejects.toThrow(/already undone/);

    // The same rows can be imported again.
    await t.line(1, "2037-01-05", -1000);
  });

  it("refuses when any of it is already reconciled", async () => {
    const t = await importOf("Reconciled LLC");
    await t.post(await t.line(1, "2037-02-05", -1500), 1500);
    const lineId = (await db.query<{ id: string }>(`select l.id from journal_lines l join accounts a on a.id = l.account_id where l.entity_id = $1 and a.code = '1000'`, [t.ent])).rows[0].id;
    await db.query(`select complete_reconciliation($1, '2037-02-28'::date, -1500, $2::uuid[])`, [t.cash, [lineId]]);
    await expect(db.query(`select * from undo_import_batch($1)`, [t.batch])).rejects.toThrow(/bank reconciliation/);
  });

  it("dates a reversal today when the original period is locked", async () => {
    const t = await importOf("Locked Books LLC");
    await t.post(await t.line(1, "2020-03-05", -700), 700);
    await db.query(`update entities set books_locked_through = '2020-03-31' where id = $1`, [t.ent]);
    await db.query(`select * from undo_import_batch($1)`, [t.batch]);
    const rev = (await db.query<{ d: string }>(`select entry_date::text d from journal_entries where entity_id = $1 and source = 'reversal'`, [t.ent])).rows[0].d;
    expect(rev > "2020-03-31").toBe(true);
  });
});
