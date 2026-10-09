-- Preserve real capture times; never infer cash-flow occurrence from entry time.
alter table portfolio.cash_flows add column if not exists occurred_at timestamptz;
alter table portfolio.cash_flows add column if not exists deleted_at timestamptz;
alter table portfolio.cash_flows add constraint cash_flows_occurrence_day
  check (occurred_at is null or (occurred_at at time zone 'Asia/Seoul')::date = flow_date);

create table portfolio.snapshot_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."User"("userId") on delete cascade,
  snapshot_date date not null,
  bucket_key text not null,
  bucket_name text not null,
  value_krw numeric(24,2) not null check (value_krw >= 0),
  target_percent numeric(5,2),
  position_signature text,
  captured_at timestamptz not null,
  unique (user_id, bucket_key, captured_at)
);
create index snapshot_events_user_bucket_time_idx on portfolio.snapshot_events(user_id,bucket_key,captured_at);
alter table portfolio.snapshot_events enable row level security;
revoke all on portfolio.snapshot_events from public, anon, authenticated;

insert into portfolio.snapshot_events(user_id,snapshot_date,bucket_key,bucket_name,value_krw,target_percent,position_signature,captured_at)
select user_id,snapshot_date,bucket_key,bucket_name,value_krw,target_percent,position_signature,captured_at from portfolio.snapshots
on conflict (user_id,bucket_key,captured_at) do nothing;

-- Daily summaries stay compatible with existing consumers. Each save also keeps
-- an immutable intraday observation, so updating today's summary loses no baseline.
create function portfolio.capture_snapshot_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into portfolio.snapshot_events(user_id,snapshot_date,bucket_key,bucket_name,value_krw,target_percent,position_signature,captured_at)
  values (new.user_id,new.snapshot_date,new.bucket_key,new.bucket_name,new.value_krw,new.target_percent,new.position_signature,new.captured_at)
  on conflict (user_id,bucket_key,captured_at) do update set
    bucket_name=excluded.bucket_name, value_krw=excluded.value_krw,
    target_percent=excluded.target_percent, position_signature=excluded.position_signature;
  return new;
end;
$$;
revoke all on function portfolio.capture_snapshot_event() from public, anon, authenticated;
create trigger capture_snapshot_event after insert or update on portfolio.snapshots
for each row execute function portfolio.capture_snapshot_event();
