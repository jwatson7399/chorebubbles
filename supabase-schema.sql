-- ChoreBubbles secure shared storage
--
-- Before running this file, replace:
--   REPLACE_WITH_YOUR_HOUSEHOLD_ID
--   person.one@example.com
--   person.two@example.com

create table if not exists public.chorebubbles (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  member_emails text[],
  updated_at timestamptz not null default now()
);

-- Safe migration for the original ChoreBubbles table.
alter table public.chorebubbles add column if not exists revision bigint not null default 0;
alter table public.chorebubbles add column if not exists member_emails text[];

insert into public.chorebubbles (id, value, revision, member_emails)
values (
  'cb_e3ba63db0abfdac37e3bb98a8e769785',
  '{"chores":[],"completions":[],"pauses":[],"settings":{"nameA":"Person 1","nameB":"Person 2","weeklyGoal":14,"halfLifeDays":7},"updatedAt":0}'::jsonb,
  0,
  array['person.one@example.com', 'person.two@example.com']
)
on conflict (id) do update
set member_emails = excluded.member_emails;

alter table public.chorebubbles enable row level security;

drop policy if exists "household access" on public.chorebubbles;
drop policy if exists "household members can read" on public.chorebubbles;
drop policy if exists "household members can update" on public.chorebubbles;

create policy "household members can read"
on public.chorebubbles
for select
to authenticated
using (
  exists (
    select 1
    from unnest(coalesce(member_emails, array[]::text[])) as allowed_email
    where lower(allowed_email) = lower(auth.jwt() ->> 'email')
  )
);

create policy "household members can update"
on public.chorebubbles
for update
to authenticated
using (
  exists (
    select 1
    from unnest(coalesce(member_emails, array[]::text[])) as allowed_email
    where lower(allowed_email) = lower(auth.jwt() ->> 'email')
  )
)
with check (
  exists (
    select 1
    from unnest(coalesce(member_emails, array[]::text[])) as allowed_email
    where lower(allowed_email) = lower(auth.jwt() ->> 'email')
  )
);

revoke all on table public.chorebubbles from anon;
revoke insert, delete on table public.chorebubbles from authenticated;
revoke update on table public.chorebubbles from authenticated;
grant select on table public.chorebubbles to authenticated;
grant update (value, revision, updated_at) on table public.chorebubbles to authenticated;
