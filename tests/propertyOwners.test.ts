import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, seedEntity } from "./db";

let db: PGlite;
let s: Awaited<ReturnType<typeof seedEntity>>;

beforeAll(async () => {
  db = await freshDb();
  s = await seedEntity(db);
});

async function setup(label: string) {
  const entity = async (name: string) => (await db.query<{ id: string }>(`insert into entities (workspace_id, name) values ($1, $2) returning id`, [s.ws, `${label} ${name}`])).rows[0].id;
  const a = await entity("A LLC");
  const b = await entity("B LLC");
  await db.query(`select seed_default_chart($1)`, [a]);
  const portfolio = (await db.query<{ id: string }>(`select id from portfolios where workspace_id = $1 limit 1`, [s.ws])).rows[0].id;
  const property = async (name: string, owner: string) =>
    (await db.query<{ id: string }>(`insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1, $2, $3, $4) returning id`, [s.ws, portfolio, owner, `${label} ${name}`])).rows[0].id;
  const set = (prop: string, primary: string, owners: { entity_id: string; percent_bp: number }[]) =>
    db.query(`select set_property_owners($1, $2, $3::jsonb)`, [prop, primary, JSON.stringify(owners)]);
  const owners = async (prop: string) =>
    (await db.query(`select entity_id, percent_bp from property_owners where property_id = $1 order by percent_bp desc`, [prop])).rows as { entity_id: string; percent_bp: number }[];
  return { a, b, portfolio, property, set, owners };
}

describe("property owners", () => {
  it("starts every property with its entity as the only owner", async () => {
    const t = await setup("Start");
    const p = await t.property("House", t.a);
    expect(await t.owners(p)).toEqual([{ entity_id: t.a, percent_bp: 10000 }]);
  });

  it("splits a property between entities by percentage", async () => {
    const t = await setup("Split");
    const p = await t.property("Duplex", t.a);
    await t.set(p, t.a, [{ entity_id: t.a, percent_bp: 6000 }, { entity_id: t.b, percent_bp: 4000 }]);
    expect(await t.owners(p)).toEqual([{ entity_id: t.a, percent_bp: 6000 }, { entity_id: t.b, percent_bp: 4000 }]);
  });

  it("refuses shares that do not add up to 100%, repeat an owner, or have none", async () => {
    const t = await setup("Rules");
    const p = await t.property("Condo", t.a);
    await expect(t.set(p, t.a, [{ entity_id: t.a, percent_bp: 6000 }, { entity_id: t.b, percent_bp: 3000 }])).rejects.toThrow(/add up to 90\.00 percent/);
    await expect(t.set(p, t.a, [{ entity_id: t.a, percent_bp: 5000 }, { entity_id: t.a, percent_bp: 5000 }])).rejects.toThrow(/only once/);
    await expect(t.set(p, t.a, [{ entity_id: t.a, percent_bp: 10000 }, { entity_id: t.b, percent_bp: 0 }])).rejects.toThrow(/above zero/);
    await expect(t.set(p, t.a, [])).rejects.toThrow(/at least one owner/);
    await expect(t.set(p, t.b, [{ entity_id: t.a, percent_bp: 10000 }])).rejects.toThrow(/must be one of the owners/);
    expect(await t.owners(p)).toEqual([{ entity_id: t.a, percent_bp: 10000 }]); // nothing changed
  });

  it("lets the owner that keeps the books change only before there are transactions", async () => {
    const t = await setup("Primary");
    const early = await t.property("Early", t.a);
    await t.set(early, t.b, [{ entity_id: t.a, percent_bp: 5000 }, { entity_id: t.b, percent_bp: 5000 }]);
    expect((await db.query<{ entity_id: string }>(`select entity_id from properties where id = $1`, [early])).rows[0].entity_id).toBe(t.b);

    const busy = await t.property("Busy", t.a);
    const cash = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '1000'`, [t.a])).rows[0].id;
    const rent = (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = '4000'`, [t.a])).rows[0].id;
    await db.query(`select post_entry($1, '2038-01-05'::date, 'Rent', $2::jsonb)`, [t.a, JSON.stringify([
      { account_id: cash, property_id: busy, debit_cents: 100000 },
      { account_id: rent, property_id: busy, credit_cents: 100000 },
    ])]);
    await expect(t.set(busy, t.b, [{ entity_id: t.a, percent_bp: 5000 }, { entity_id: t.b, percent_bp: 5000 }])).rejects.toThrow(/cannot change/);
    // The percentages can still be set while the same entity keeps the books.
    await t.set(busy, t.a, [{ entity_id: t.a, percent_bp: 7000 }, { entity_id: t.b, percent_bp: 3000 }]);
    expect((await t.owners(busy)).map((o) => o.percent_bp)).toEqual([7000, 3000]);
  });

  it("lets a portfolio name a default owner", async () => {
    const t = await setup("Default");
    await db.query(`update portfolios set default_entity_id = $1 where id = $2`, [t.b, t.portfolio]);
    expect((await db.query<{ d: string }>(`select default_entity_id d from portfolios where id = $1`, [t.portfolio])).rows[0].d).toBe(t.b);
    await db.query(`update portfolios set default_entity_id = null where id = $1`, [t.portfolio]);
  });
});
