-- Private application tables. NextAuth sessions are authorized by the server,
-- not Supabase user-editable metadata. No direct Data API access.
create table portfolio.members (
  user_id text primary key references public."User"("userId") on delete cascade,
  joined_at timestamptz not null default now(),
  last_login_at timestamptz,
  is_admin boolean not null default false
);
create table portfolio.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  important boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table portfolio.admin_events (
  id bigint generated always as identity primary key,
  actor_id text not null,
  action text not null,
  announcement_id uuid references portfolio.announcements(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index announcements_visible on portfolio.announcements(status, important desc, created_at desc);
alter table portfolio.members enable row level security;
alter table portfolio.announcements enable row level security;
alter table portfolio.admin_events enable row level security;
revoke all on portfolio.members, portfolio.announcements, portfolio.admin_events from public, anon, authenticated;
revoke all on sequence portfolio.admin_events_id_seq from public, anon, authenticated;
insert into portfolio.members(user_id) select user_id from portfolio.plans on conflict do nothing;
