import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, seedEntity } from "./db";

let db: PGlite;
let s: Awaited<ReturnType<typeof seedEntity>>;

beforeAll(async () => {
  db = await freshDb();
  s = await seedEntity(db);
});

async function setup(label: string, owners = 2) {
  const entity = async (n: string) => (await db.query<{ id: string }>(`insert into entities (workspace_id, name) values ($1, $2) returning id`, [s.ws, `${label} ${n}`])).rows[0].id;
  const ids = [await entity("A"), await entity("B"), await entity("C")].slice(0, owners);
  await db.query(`select seed_default_chart($1)`, [ids[0]]);
  const portfolio = (await db.query<{ id: string }>(`select id from portfolios where workspace_id = $1 limit 1`, [s.ws])).rows[0].id;
  const property = (await db.query<{ id: string }>(`insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1, $2, $3, $4) returning id`, [s.ws, portfolio, ids[0], `${label} Duplex`])).rows[0].id;
  const acct = async (code: string) => (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = $2`, [ids[0], code])).rows[0].id;
  const post = async (date: string, memo: string, debit: string, credit: string, cents: number, prop: string | null = property) =>
    db.query(`select post_entry($1, $2::date, $3, $4::jsonb)`, [ids[0], date, memo, JSON.stringify([
      { account_id: await acct(debit), property_id: prop, debit_cents: cents },
      { account_id: await acct(credit), property_id: prop, credit_cents: cents },
    ])]);
  const own = (shares: number[]) =>
    db.query(`select set_property_owners($1, $2, $3::jsonb)`, [property, ids[0], JSON.stringify(ids.map((id, i) => ({ entity_id: id, percent_bp: shares[i] })))]);
  const rent = async (entityFilter: string[] | null, allocate: boolean, group = "total") =>
    (await db.query(
      `select r.bucket, sum(r.net_cents)::int n from report_activity('2039-01-01', '2039-12-31', $1, null, $2::uuid[], $3) r join accounts a on a.id = r.account_id where a.code = '4000' group by r.bucket order by r.bucket`,
      [group, entityFilter, allocate],
    )).rows as { bucket: string; n: number }[];
  return { ids, property, post, own, rent };
}

describe("ownership shares in reports", () => {
  it("shows each owner its share of a co-owned property, and all of them add up to the whole", async () => {
    const t = await setup("Share");
    await t.own([6000, 4000]);
    await t.post("2039-03-01", "Rent", "1000", "4000", 100000);

    // Rent is a credit, so negative. A keeps $600.00 of it, B has $400.00.
    expect(await t.rent([t.ids[0]], true)).toEqual([{ bucket: "all", n: -60000 }]);
    expect(await t.rent([t.ids[1]], true)).toEqual([{ bucket: "all", n: -40000 }]);
    expect(await t.rent(t.ids, true)).toEqual([{ bucket: "all", n: -100000 }]);
    expect(await t.rent([t.ids[0], t.ids[1]], true)).toEqual([{ bucket: "all", n: -100000 }]);

    // By business, each owner is its own column.
    const cols = await t.rent(t.ids, true, "entity");
    expect(cols).toEqual([{ bucket: t.ids[0], n: -60000 }, { bucket: t.ids[1], n: -40000 }].sort((a, b) => a.bucket.localeCompare(b.bucket)));
  });

  it("leaves the books as recorded when shares are not asked for", async () => {
    const t = await setup("Whole");
    await t.own([6000, 4000]);
    await t.post("2039-03-01", "Rent", "1000", "4000", 100000);
    expect(await t.rent([t.ids[0]], false)).toEqual([{ bucket: "all", n: -100000 }]); // all of it is in A's books
    expect(await t.rent([t.ids[1]], false)).toEqual([]);
  });

  it("keeps a sole owner's numbers exactly as they were", async () => {
    const t = await setup("Sole", 1);
    await t.post("2039-03-01", "Rent", "1000", "4000", 123456);
    expect(await t.rent([t.ids[0]], true)).toEqual(await t.rent([t.ids[0]], false));
  });

  it("splits in whole cents and gives any odd cent to the owner that keeps the books", async () => {
    const t = await setup("Cents", 3);
    await t.own([3333, 3333, 3334]); // the books-keeper (A) holds 33.33%
    await t.post("2039-03-01", "Rent", "1000", "4000", 10000); // $100.00
    const parts = await t.rent(t.ids, true, "entity");
    const byId = new Map(parts.map((p) => [p.bucket, p.n]));
    expect(byId.get(t.ids[1])).toBe(-3333);
    expect(byId.get(t.ids[2])).toBe(-3334);
    expect(byId.get(t.ids[0])).toBe(-3333);
    expect(parts.reduce((x, p) => x + p.n, 0)).toBe(-10000);

    // An amount that does not divide evenly still adds up exactly.
    await t.post("2039-03-02", "Rent", "1000", "4000", 1);
    expect((await t.rent(t.ids, true)).reduce((x, p) => x + p.n, 0)).toBe(-10001);
  });

  it("keeps lines with no property whole, in the books they are in", async () => {
    const t = await setup("NoProperty");
    await t.own([5000, 5000]);
    await t.post("2039-03-01", "Rent", "1000", "4000", 80000, null);
    expect(await t.rent([t.ids[0]], true)).toEqual([{ bucket: "all", n: -80000 }]);
    expect(await t.rent([t.ids[1]], true)).toEqual([]);
  });
});
