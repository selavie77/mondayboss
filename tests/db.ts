import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Minimal stand-in for Supabase's auth schema so the migration runs in embedded Postgres.
const AUTH_STUB = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  const dir = path.resolve(import.meta.dirname, "../supabase/migrations");
  for (const f of readdirSync(dir).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  return db;
}

export async function seedEntity(db: PGlite) {
  const user = (await db.query<{ id: string }>(`insert into auth.users (email) values ('t@example.com') returning id`)).rows[0].id;
  const ws = (await db.query<{ id: string }>(`select workspace_id as id from workspace_members where user_id = $1`, [user])).rows[0].id;
  const pf = (await db.query<{ id: string }>(`select id from portfolios where workspace_id = $1`, [ws])).rows[0].id;
  const ent = (await db.query<{ id: string }>(
    `insert into entities (workspace_id, name) values ($1, 'Test LLC') returning id`, [ws])).rows[0].id;
  await db.query(`select seed_default_chart($1)`, [ent]);
  const prop = (await db.query<{ id: string }>(
    `insert into properties (workspace_id, portfolio_id, entity_id, name) values ($1,$2,$3,'1 Main St') returning id`,
    [ws, pf, ent])).rows[0].id;
  const acct = async (code: string) =>
    (await db.query<{ id: string }>(`select id from accounts where entity_id = $1 and code = $2`, [ent, code])).rows[0].id;
  return { user, ws, pf, ent, prop, acct };
}
