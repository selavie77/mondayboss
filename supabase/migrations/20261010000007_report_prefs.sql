-- Per-user report preferences: which reports are favorites and when each was last opened.
create table report_prefs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  report_key text not null check (char_length(report_key) <= 60),
  is_favorite boolean not null default false,
  last_visited_at timestamptz,
  primary key (user_id, report_key)
);

alter table report_prefs enable row level security;
create policy report_prefs_own on report_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
