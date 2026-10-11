begin;
select plan(20);

-- Two users, each gets their own workspace via the sign-up trigger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com', '{}'::jsonb),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com', '{}'::jsonb);

select is((select count(*)::int from workspaces where created_by in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')), 2, 'each sign-up creates a workspace');
select is((select count(*)::int from portfolios p join workspaces w on w.id = p.workspace_id where w.created_by in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')), 2, 'each sign-up creates a default portfolio');

-- User A creates an entity and posts an entry.
create temp table ctx as
select w.id as ws_a,
       (select id from portfolios where workspace_id = w.id) as pf_a
from workspaces w where w.created_by = 'aaaaaaaa-0000-0000-0000-000000000001';
grant all on ctx to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into entities (workspace_id, name) select ws_a, 'A LLC' from ctx;
select lives_ok($$select seed_default_chart((select id from entities where name = 'A LLC'))$$, 'user A can seed a chart');
select lives_ok($$
  select post_entry(
    (select id from entities where name = 'A LLC'), '2021-03-01', 'rent',
    jsonb_build_array(
      jsonb_build_object('account_id', (select id from accounts where code = '1000'), 'debit_cents', 100000),
      jsonb_build_object('account_id', (select id from accounts where code = '4000'), 'credit_cents', 100000)))
$$, 'user A can post a balanced entry');
select is((select count(*)::int from journal_entries), 1, 'user A sees their entry');

insert into properties (workspace_id, portfolio_id, entity_id, name)
  select ws_a, pf_a, (select id from entities where name = 'A LLC'), 'A House' from ctx;
insert into capital_expenses (workspace_id, property_id, name, amount_cents, spent_on)
  select ws_a, (select id from properties where name = 'A House'), 'Purchase', 9000000, '2019-09-06' from ctx;
select is((select count(*)::int from capital_expenses), 1, 'user A sees their capital expense');
insert into report_prefs (user_id, report_key, is_favorite) values ('aaaaaaaa-0000-0000-0000-000000000001', 'income-statement', true);
select is((select count(*)::int from report_prefs), 1, 'user A sees their report favorites');
insert into import_batches (workspace_id, entity_id, source)
  select ws_a, (select id from entities where name = 'A LLC'), 'test' from ctx;
select is((select count(*)::int from import_batch_summary), 1, 'user A sees their import history');
select is((select count(*)::int from report_activity('2021-01-01', '2021-12-31')), 2, 'user A report query returns their activity');

-- User B sees none of A's data.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from entities), 0, 'user B cannot see A entities');
select is((select count(*)::int from journal_entries), 0, 'user B cannot see A journal entries');
select is((select count(*)::int from journal_lines), 0, 'user B cannot see A journal lines');
select is((select count(*)::int from trial_balance), 0, 'user B cannot see A trial balance');
select is((select count(*)::int from capital_expenses), 0, 'user B cannot see A capital expenses');
select is((select count(*)::int from report_prefs), 0, 'user B cannot see A report favorites');
select is((select count(*)::int from import_batch_summary), 0, 'user B cannot see A import history');
select is((select count(*)::int from report_activity('2021-01-01', '2021-12-31')), 0, 'user B report query returns nothing of A');

-- User B cannot write into A's workspace.
select throws_ok($$insert into entities (workspace_id, name) select ws_a, 'Intruder LLC' from ctx$$,
  '42501', null, 'user B cannot insert into A workspace');

-- Journal stays append-only even for the owner.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
update journal_lines set debit_cents = 1;
delete from journal_entries;
select is((select count(*)::int from journal_entries), 1, 'owner cannot delete posted entries (RLS blocks it)');
select is((select sum(debit_cents)::int from journal_lines), 100000, 'owner cannot update posted lines (RLS blocks it)');

select * from finish();
rollback;
