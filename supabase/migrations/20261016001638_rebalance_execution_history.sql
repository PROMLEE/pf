create table portfolio.rebalance_runs (
 id uuid primary key,
 user_id text not null references public."User"("userId") on delete cascade,
 status text not null default 'active' check(status in ('active','completed','cancelled')),
 revision integer not null default 0 check(revision>=0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 outcome jsonb,
 created_at timestamptz not null default now(),
 ended_at timestamptz,
 unique(user_id,id),
 check((status='active' and ended_at is null) or (status<>'active' and ended_at is not null))
);
create unique index rebalance_runs_one_active_owner_idx on portfolio.rebalance_runs(user_id) where status='active';
create index rebalance_runs_owner_time_idx on portfolio.rebalance_runs(user_id,created_at desc,id desc);
create table portfolio.rebalance_fills (
 id uuid not null,
 user_id text not null,
 run_id uuid not null,
 item_id uuid not null,
 holding_id uuid,
 quantity numeric(28,8) not null check(quantity>0),
 price numeric(28,8) not null check(price>0),
 fee numeric(24,8) not null check(fee>=0),
 currency text not null check(currency in ('KRW','USD')),
 fx_rate numeric(16,6) not null check(fx_rate>=100 and fx_rate<=100000),
 source text not null check(source in ('plan','holding-editor')),
 payload_hash text,
 created_at timestamptz not null default now(),
 primary key(user_id,id),
 foreign key(user_id,run_id) references portfolio.rebalance_runs(user_id,id) on delete cascade
);
create index rebalance_fills_owner_run_idx on portfolio.rebalance_fills(user_id,run_id,created_at,id);
alter table portfolio.rebalance_runs enable row level security;
alter table portfolio.rebalance_fills enable row level security;
revoke all on portfolio.rebalance_runs,portfolio.rebalance_fills from public,anon,authenticated;
