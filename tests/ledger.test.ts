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

describe("review queue", () => {
  const stage = async (amountCents: number, description = "Mortgage payment") => {
    const batch = (await db.query<{ id: string }>(
      `insert into import_batches (workspace_id, entity_id, source) values ($1,$2,'test') returning id`, [s.ws, s.ent])).rows[0].id;
    const hash = Math.random().toString(36);
    return (await db.query<{ id: string }>(
      `insert into statement_lines (workspace_id, entity_id, batch_id, property_id, txn_date, description, amount_cents, dedupe_hash)
       values ($1,$2,$3,$4,'2021-08-01',$5,$6,$7) returning id`,
      [s.ws, s.ent, batch, s.prop, description, amountCents, hash])).rows[0].id;
  };

  it("posts a split payment (principal / interest / escrow) from one pending line", async () => {
    const id = await stage(-55760);
    const lines = [
      { account_id: await s.acct("2100"), property_id: s.prop, debit_cents: 10400 },
      { account_id: await s.acct("5070"), property_id: s.prop, debit_cents: 24297 },
      { account_id: await s.acct("1100"), property_id: s.prop, debit_cents: 21063 },
      { account_id: await s.acct("1000"), property_id: s.prop, credit_cents: 55760 },
    ];
    await db.query(`select post_statement_line($1, $2::jsonb)`, [id, JSON.stringify(lines)]);
    const r = await db.query(`select status, journal_entry_id is not null as linked from statement_lines where id = $1`, [id]);
    expect(r.rows[0]).toMatchObject({ status: "posted", linked: true });
  });

  it("rejects lines that do not add up to the transaction amount", async () => {
    const id = await stage(-10000);
    const lines = [
      { account_id: await s.acct("5090"), debit_cents: 9999 },
      { account_id: await s.acct("1000"), credit_cents: 9999 },
    ];
    await expect(db.query(`select post_statement_line($1, $2::jsonb)`, [id, JSON.stringify(lines)])).rejects.toThrow(/Lines total/);
  });

  it("will not post the same line twice", async () => {
    const id = await stage(-5000);
    const lines = [
      { account_id: await s.acct("5090"), debit_cents: 5000 },
      { account_id: await s.acct("1000"), credit_cents: 5000 },
    ];
    await db.query(`select post_statement_line($1, $2::jsonb)`, [id, JSON.stringify(lines)]);
    await expect(db.query(`select post_statement_line($1, $2::jsonb)`, [id, JSON.stringify(lines)])).rejects.toThrow(/already posted/);
  });

  it("accepts proposed categorizations in bulk", async () => {
    const a = await stage(-1200, "Lawn care");
    const b = await stage(-3400, "Faucet");
    for (const id of [a, b]) {
      await db.query(
        `update statement_lines set proposed_debit_account_id = $2, proposed_credit_account_id = $3 where id = $1`,
        [id, await s.acct("5090"), await s.acct("1000")]);
    }
    const n = await db.query(`select accept_statement_lines($1::uuid[]) as n`, [[a, b]]);
    expect((n.rows[0] as { n: number }).n).toBe(2);
  });
});

describe("category hierarchy", () => {
  it("creates a subcategory that inherits its category's type and rolls up in reports", async () => {
    const parent = await s.acct("5090");
    const subId = (await db.query<{ id: string }>(`select ensure_subaccount($1, 'Plumbing Repairs') as id`, [parent])).rows[0].id;
    // Idempotent, case-insensitive.
    const again = (await db.query<{ id: string }>(`select ensure_subaccount($1, 'plumbing repairs') as id`, [parent])).rows[0].id;
    expect(again).toBe(subId);

    await post([
      { account_id: subId, property_id: s.prop, debit_cents: 30000 },
      { account_id: parent, property_id: s.prop, debit_cents: 12000 },
      { account_id: await s.acct("1000"), credit_cents: 42000 },
    ], "2021-09-01");

    const r = await db.query(
      `select category_name, tax_line, sum(amount_cents)::int as amt
         from property_pnl_monthly where property_id = $1 and category_name = 'Repairs' group by category_name, tax_line`, [s.prop]);
    // Subcategory and category amounts roll up under "Repairs", with the category's tax line.
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ category_name: "Repairs", tax_line: "sched_e.repairs" });
    expect((r.rows[0] as { amt: number }).amt).toBeGreaterThanOrEqual(42000);
  });

  it("generates codes for custom categories and subcategories", async () => {
    const cat = (await db.query<{ id: string }>(
      `select create_account($1, null, 'expense', 'Pest Control', 'sched_e.other') as id`, [s.ent])).rows[0].id;
    const row = (await db.query(`select code, tax_line from accounts where id = $1`, [cat])).rows[0] as { code: string; tax_line: string };
    expect(row.code).toMatch(/^5\d{3}$/);
    expect(row.tax_line).toBe("sched_e.other");
    const subId = (await db.query<{ id: string }>(`select create_account($1, $2, 'expense', 'Termites') as id`, [s.ent, cat])).rows[0].id;
    const sub = (await db.query(`select code, type from accounts where id = $1`, [subId])).rows[0] as { code: string; type: string };
    expect(sub.code).toBe(`${row.code}.01`);
    expect(sub.type).toBe("expense");
  });

  it("rejects a third level, a type mismatch, and duplicate sibling names", async () => {
    const parent = await s.acct("5090");
    const child = (await db.query<{ id: string }>(`select ensure_subaccount($1, 'HVAC Repairs') as id`, [parent])).rows[0].id;
    await expect(db.query(`select create_account($1, $2, 'expense', 'Furnace')`, [s.ent, child])).rejects.toThrow(/two levels/);
    // create_account takes the type from the parent; a direct insert with a different type is refused.
    await expect(
      db.query(
        `insert into accounts (workspace_id, entity_id, code, name, type, parent_id) values ($1,$2,'9999','Odd','income',$3)`,
        [s.ws, s.ent, parent]),
    ).rejects.toThrow(/same type/);
    await expect(db.query(`select create_account($1, null, 'expense', 'Repairs')`, [s.ent])).rejects.toThrow();
  });
});

describe("category descriptions", () => {
  it("gives every default account a description", async () => {
    const fresh = (await db.query<{ id: string }>(
      `insert into entities (workspace_id, name) values ($1, 'Fresh LLC') returning id`, [s.ws])).rows[0].id;
    await db.query(`select seed_default_chart($1)`, [fresh]);
    const r = await db.query(`select count(*)::int n, count(description)::int d from accounts where entity_id = $1`, [fresh]);
    expect(r.rows[0]).toMatchObject({ n: 29, d: 29 });
  });

  it("stores a description on custom categories and subcategories", async () => {
    const cat = (await db.query<{ id: string }>(
      `select create_account($1, null, 'expense', 'Snow Removal', null, 'Plowing and salting in winter.') as id`, [s.ent])).rows[0].id;
    const sub = (await db.query<{ id: string }>(
      `select ensure_subaccount($1, 'Salt', 'Ice melt for walkways.') as id`, [cat])).rows[0].id;
    const r = await db.query(`select id, description from accounts where id in ($1, $2) order by code`, [cat, sub]);
    expect(r.rows.map((x) => (x as { description: string }).description)).toEqual([
      "Plowing and salting in winter.",
      "Ice melt for walkways.",
    ]);
  });
});

describe("account opening balances and bank / credit card accounts", () => {
  const newEntity = async (name: string) => {
    const ent = (await db.query<{ id: string }>(`insert into entities (workspace_id, name) values ($1, $2) returning id`, [s.ws, name])).rows[0].id;
    await db.query(`select seed_default_chart($1)`, [ent]);
    return ent;
  };
  const net = async (accountId: string) =>
    Number((await db.query<{ n: string | number }>(`select coalesce(sum(debit_cents - credit_cents), 0) n from journal_lines where account_id = $1`, [accountId])).rows[0].n);

  it("creates a bank account tied to a property, with an opening balance posted as a transaction", async () => {
    const ent = await newEntity("Cash LLC");
    const prop = (await db.query<{ id: string }>(`insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1,$2,$3,'Orchard') returning id`, [s.ws, s.pf, ent])).rows[0].id;

    const id = (await db.query<{ id: string }>(
      `select create_cash_account($1, 'bank', 'Orchard Checking', '6134', $2, null, 2500000, '2020-12-31') as id`, [ent, prop])).rows[0].id;

    const a = (await db.query(`select type, subtype, is_bank, property_id, last4 from accounts where id = $1`, [id])).rows[0];
    expect(a).toMatchObject({ type: "asset", subtype: "cash", is_bank: true, property_id: prop, last4: "6134" });
    expect(await net(id)).toBe(2500000); // money in the bank: debit balance

    // The offset is Opening Balance Equity, tagged with the same property.
    const eq = (await db.query(
      `select a.name, l.credit_cents::int c, l.property_id from journal_lines l join accounts a on a.id = l.account_id
        where l.entry_id = (select entry_id from journal_lines where account_id = $1) and a.type = 'equity'`, [id])).rows[0];
    expect(eq).toMatchObject({ name: "Opening Balance Equity", c: 2500000, property_id: prop });
    const e = (await db.query(`select source, memo from journal_entries where id = (select entry_id from journal_lines where account_id = $1)`, [id])).rows[0];
    expect(e).toMatchObject({ source: "system", memo: "Opening balance: Orchard Checking" });
  });

  it("a credit card's opening balance is money owed (a credit balance)", async () => {
    const ent = await newEntity("Card LLC");
    const id = (await db.query<{ id: string }>(
      `select create_cash_account($1, 'credit_card', 'Business Card', null, null, null, 1200000, '2020-12-31') as id`, [ent])).rows[0].id;
    expect(await net(id)).toBe(-1200000);
    expect((await db.query(`select type, subtype, is_bank from accounts where id = $1`, [id])).rows[0]).toMatchObject({ type: "liability", subtype: "credit_card", is_bank: false });
  });

  it("a negative amount flips the side (an overdraft)", async () => {
    const ent = await newEntity("Overdraft LLC");
    const id = (await db.query<{ id: string }>(`select create_cash_account($1, 'bank', 'Checking 2', null, null, null, -50000, '2020-12-31') as id`, [ent])).rows[0].id;
    expect(await net(id)).toBe(-50000);
  });

  it("can be tied to a portfolio, but not to a property and a portfolio at once", async () => {
    const ent = await newEntity("Tie LLC");
    const prop = (await db.query<{ id: string }>(`insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1,$2,$3,'Tie House') returning id`, [s.ws, s.pf, ent])).rows[0].id;
    const id = (await db.query<{ id: string }>(`select create_cash_account($1, 'bank', 'Portfolio Bank', null, null, $2) as id`, [ent, s.pf])).rows[0].id;
    expect((await db.query(`select portfolio_id, property_id from accounts where id = $1`, [id])).rows[0]).toMatchObject({ portfolio_id: s.pf, property_id: null });
    await expect(db.query(`select create_cash_account($1, 'bank', 'Both', null, $2, $3)`, [ent, prop, s.pf])).rejects.toThrow(/not both/);
  });

  it("refuses a second opening balance on the same account until the first is reversed", async () => {
    const ent = await newEntity("Twice LLC");
    const id = (await db.query<{ id: string }>(`select create_cash_account($1, 'bank', 'Once Bank', null, null, null, 10000, '2020-12-31') as id`, [ent])).rows[0].id;
    await expect(db.query(`select set_account_opening_balance($1, '2020-12-31', 5000)`, [id])).rejects.toThrow(/already has an opening balance/);

    const entry = (await db.query<{ entry_id: string }>(`select entry_id from journal_lines where account_id = $1`, [id])).rows[0].entry_id;
    await db.query(`select reverse_entry($1, '2020-12-31')`, [entry]);
    expect(await net(id)).toBe(0);
    await db.query(`select set_account_opening_balance($1, '2020-12-31', 5000)`, [id]);
    expect(await net(id)).toBe(5000);
  });

  it("refuses income and expense accounts and a zero amount", async () => {
    const ent = await newEntity("Guard LLC");
    const rent = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '4000'`, [ent])).rows[0].id;
    await expect(db.query(`select set_account_opening_balance($1, '2020-12-31', 100)`, [rent])).rejects.toThrow(/asset and liability/);
    const cash = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '1000'`, [ent])).rows[0].id;
    await expect(db.query(`select set_account_opening_balance($1, '2020-12-31', 0)`, [cash])).rejects.toThrow(/Enter an opening balance/);
  });

  it("works for other balance sheet accounts too, such as a mortgage (money owed)", async () => {
    const ent = await newEntity("Loan LLC");
    const loan = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '2100'`, [ent])).rows[0].id;
    await db.query(`select set_account_opening_balance($1, '2020-12-31', 7850000)`, [loan]);
    expect(await net(loan)).toBe(-7850000);
  });
});

describe("general Transfers account", () => {
  it("is created once, on demand, as an equity account", async () => {
    const ent = (await db.query<{ id: string }>(`insert into entities (workspace_id, name) values ($1, 'Transfers LLC') returning id`, [s.ws])).rows[0].id;
    await db.query(`select seed_default_chart($1)`, [ent]);
    const first = (await db.query<{ id: string }>(`select ensure_transfers_account($1) as id`, [ent])).rows[0].id;
    const again = (await db.query<{ id: string }>(`select ensure_transfers_account($1) as id`, [ent])).rows[0].id;
    expect(again).toBe(first);
    expect((await db.query(`select code, name, type, subtype from accounts where id = $1`, [first])).rows[0]).toMatchObject({
      code: "3200", name: "Transfers", type: "equity", subtype: "transfers",
    });
  });
});

describe("batch posting of statement lines", () => {
  const stage = async (cents: number) => {
    const batch = (await db.query<{ id: string }>(`insert into import_batches (workspace_id, entity_id, source) values ($1,$2,'test') returning id`, [s.ws, s.ent])).rows[0].id;
    return (await db.query<{ id: string }>(
      `insert into statement_lines (workspace_id, entity_id, batch_id, txn_date, description, amount_cents, dedupe_hash)
       values ($1,$2,$3,'2021-09-15','batch line',$4,$5) returning id`, [s.ws, s.ent, batch, cents, Math.random().toString(36)])).rows[0].id;
  };

  it("posts every line in one call", async () => {
    const a = await stage(-1000);
    const b = await stage(-2000);
    const lines = async (n: number) => [
      { account_id: await s.acct("5090"), debit_cents: n },
      { account_id: await s.acct("1000"), credit_cents: n },
    ];
    const items = [
      { line_id: a, lines: await lines(1000) },
      { line_id: b, lines: await lines(2000) },
    ];
    const r = await db.query(`select post_statement_lines_batch($1::jsonb) as n`, [JSON.stringify(items)]);
    expect((r.rows[0] as { n: number }).n).toBe(2);
    const posted = await db.query(`select count(*)::int n from statement_lines where id = any($1::uuid[]) and status = 'posted'`, [[a, b]]);
    expect((posted.rows[0] as { n: number }).n).toBe(2);
  });

  it("posts nothing if any line in the call is rejected", async () => {
    const good = await stage(-500);
    const bad = await stage(-700);
    const ok = [{ account_id: await s.acct("5090"), debit_cents: 500 }, { account_id: await s.acct("1000"), credit_cents: 500 }];
    const wrongTotal = [{ account_id: await s.acct("5090"), debit_cents: 1 }, { account_id: await s.acct("1000"), credit_cents: 1 }];
    await expect(
      db.query(`select post_statement_lines_batch($1::jsonb)`, [JSON.stringify([{ line_id: good, lines: ok }, { line_id: bad, lines: wrongTotal }])]),
    ).rejects.toThrow(/Lines total/);
    const status = await db.query(`select status from statement_lines where id = $1`, [good]);
    expect((status.rows[0] as { status: string }).status).toBe("pending");
  });
});
