import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, seedEntity } from "./db";

let db: PGlite;
let s: Awaited<ReturnType<typeof seedEntity>>;

const post = (lines: object[], date = "2021-03-01") =>
  db.query(`select post_entry($1, $2::date, 'test', $3::jsonb)`, [s.ent, date, JSON.stringify(lines)]);

beforeAll(async () => {
  db = await freshDb();
  s = await seedEntity(db);
});

describe("workspace sign-up", () => {
  it("creates a workspace, membership and default portfolio for a new user", async () => {
    const r = await db.query(`select count(*)::int as n from portfolios where workspace_id = $1`, [s.ws]);
    expect((r.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("double-entry integrity", () => {
  it("accepts a balanced entry", async () => {
    await post([
      { account_id: await s.acct("1000"), debit_cents: 105000 },
      { account_id: await s.acct("4000"), property_id: s.prop, credit_cents: 105000 },
    ]);
    const tb = await db.query(`select sum(debit_cents)::int d, sum(credit_cents)::int c from trial_balance where entity_id = $1`, [s.ent]);
    const row = tb.rows[0] as { d: number; c: number };
    expect(row.d).toBe(row.c);
  });

  it("rejects an unbalanced entry", async () => {
    await expect(
      post([
        { account_id: await s.acct("1000"), debit_cents: 100 },
        { account_id: await s.acct("4000"), credit_cents: 99 },
      ]),
    ).rejects.toThrow(/out of balance/);
  });

  it("rejects a single-line entry", async () => {
    await expect(post([{ account_id: await s.acct("1000"), debit_cents: 100 }])).rejects.toThrow();
  });

  it("rejects a line with both debit and credit", async () => {
    await expect(
      post([
        { account_id: await s.acct("1000"), debit_cents: 100, credit_cents: 100 },
        { account_id: await s.acct("4000"), credit_cents: 0, debit_cents: 0 },
      ]),
    ).rejects.toThrow();
  });

  it("rejects an account from a different entity", async () => {
    const other = (await db.query<{ id: string }>(
      `insert into entities (workspace_id, name) values ($1, 'Other LLC') returning id`, [s.ws])).rows[0].id;
    await db.query(`select seed_default_chart($1)`, [other]);
    const foreign = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '4000'`, [other])).rows[0].id;
    await expect(
      post([
        { account_id: await s.acct("1000"), debit_cents: 100 },
        { account_id: foreign, credit_cents: 100 },
      ]),
    ).rejects.toThrow();
  });
});

describe("immutability and reversals", () => {
  it("blocks updates and deletes on posted lines", async () => {
    await expect(db.query(`update journal_lines set debit_cents = debit_cents + 1`)).rejects.toThrow(/immutable/);
    await expect(db.query(`delete from journal_entries`)).rejects.toThrow(/immutable/);
  });

  it("reverses an entry by mirroring its lines, and only once", async () => {
    const id = (await post([
      { account_id: await s.acct("5120"), property_id: s.prop, debit_cents: 2622 },
      { account_id: await s.acct("1000"), credit_cents: 2622 },
    ], "2021-04-01")).rows[0] as { post_entry: string };
    await db.query(`select reverse_entry($1, '2021-04-02')`, [id.post_entry]);
    const bal = await db.query(`select balance_cents::int b from trial_balance where entity_id = $1 and code = '5120'`, [s.ent]);
    expect((bal.rows[0] as { b: number }).b).toBe(0);
    await expect(db.query(`select reverse_entry($1, '2021-04-03')`, [id.post_entry])).rejects.toThrow();
  });
});

describe("period lock", () => {
  it("blocks posting on or before the locked date", async () => {
    await db.query(`update entities set books_locked_through = '2021-06-30' where id = $1`, [s.ent]);
    await expect(
      post([
        { account_id: await s.acct("1000"), debit_cents: 100 },
        { account_id: await s.acct("4000"), credit_cents: 100 },
      ], "2021-06-30"),
    ).rejects.toThrow(/locked/);
    await post([
      { account_id: await s.acct("1000"), debit_cents: 100 },
      { account_id: await s.acct("4000"), credit_cents: 100 },
    ], "2021-07-01");
  });
});

describe("property P&L view", () => {
  it("rolls income by property and month", async () => {
    const r = await db.query(
      `select amount_cents::int a from property_pnl_monthly where property_id = $1 and code = '4000'`, [s.prop]);
    expect((r.rows[0] as { a: number }).a).toBe(105000);
  });
});
