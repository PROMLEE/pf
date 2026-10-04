-- Apply to the existing MeetIntheMiddle Supabase project before deploying the app.
-- The portfolio schema remains private and is accessed only by the server.
alter table portfolio.plans
  add column if not exists usd_krw_updated_at timestamptz not null default now();
-- Existing plans predate this column. Use their last saved time as the best
-- available estimate of when the manually entered rate was last changed.
update portfolio.plans
  set usd_krw_updated_at = updated_at
  where updated_at < usd_krw_updated_at;

create table if not exists portfolio.cash_flows (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  flow_date date not null,
  amount_krw numeric(24, 2) not null check (amount_krw <> 0),
  note text not null default '' check (length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists cash_flows_user_date_idx
  on portfolio.cash_flows (user_id, flow_date desc, created_at desc);
alter table portfolio.cash_flows enable row level security;
revoke all on portfolio.cash_flows from public, anon, authenticated;
