-- Applied to the existing MeetIntheMiddle Supabase project.
-- The app reuses public."User" IDs and accesses this private schema through Next.js only.
create schema if not exists portfolio;
revoke all on schema portfolio from public, anon, authenticated;

create table if not exists portfolio.holdings (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  broker text not null check (length(btrim(broker)) between 1 and 80),
  account_label text not null check (length(btrim(account_label)) between 1 and 120),
  market text not null check (market in ('KR', 'US')),
  name text not null check (length(btrim(name)) between 1 and 200),
  symbol text not null default '',
  exchange_code text check (exchange_code is null or exchange_code in ('KOSPI', 'KOSDAQ', 'NAS', 'NYS', 'AMS')),
  quantity numeric(24, 6) not null check (quantity > 0),
  captured_price numeric(24, 6) check (captured_price > 0),
  average_cost numeric(24, 6) check (average_cost > 0),
  captured_at timestamptz not null,
  current_price numeric(24, 6) check (current_price > 0),
  quote_label text,
  quote_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table portfolio.holdings add column if not exists average_cost numeric(24, 6) check (average_cost > 0);
alter table portfolio.holdings add column if not exists exchange_code text check (exchange_code is null or exchange_code in ('KOSPI', 'KOSDAQ', 'NAS', 'NYS', 'AMS'));

create index if not exists holdings_user_id_idx on portfolio.holdings (user_id, created_at desc);
drop index if exists portfolio.holdings_known_symbol_idx;
create unique index if not exists holdings_known_symbol_idx
  on portfolio.holdings (user_id, lower(broker), lower(account_label), market, symbol, coalesce(exchange_code, ''))
  where symbol <> '';
alter table portfolio.holdings enable row level security;
revoke all on portfolio.holdings from public, anon, authenticated;

create table if not exists portfolio.plans (
  user_id text primary key references public."User"("userId") on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  usd_krw numeric(16, 4) not null check (usd_krw > 0),
  tolerance_percent numeric(5, 2) not null default 5 check (tolerance_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists portfolio.buckets (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  target_percent numeric(5, 2) not null check (target_percent between 0 and 100),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null check (position >= 0),
  unique (user_id, id)
);
create index if not exists buckets_user_position_idx on portfolio.buckets (user_id, position);

alter table portfolio.holdings add column if not exists bucket_id uuid;
alter table portfolio.holdings add column if not exists assignment_source text not null default 'auto' check (assignment_source in ('auto', 'manual'));
do $$ begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'portfolio.holdings'::regclass
      and conname = 'holdings_bucket_owner_fkey'
  ) then
    alter table portfolio.holdings add constraint holdings_bucket_owner_fkey
      foreign key (user_id, bucket_id) references portfolio.buckets (user_id, id)
      on delete set null (bucket_id);
  end if;
end $$;
create index if not exists holdings_bucket_idx on portfolio.holdings (user_id, bucket_id);

create table if not exists portfolio.rules (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  bucket_id uuid not null,
  market text not null check (market in ('KR', 'US')),
  symbol text not null,
  exchange_code text,
  name text not null default '',
  manual_price numeric(24, 6) check (manual_price > 0),
  quoted_price numeric(24, 6) check (quoted_price > 0),
  quote_checked_at timestamptz,
  position integer not null check (position >= 0),
  constraint rules_bucket_owner_fkey
    foreign key (user_id, bucket_id) references portfolio.buckets (user_id, id)
    on delete cascade,
  unique (user_id, market, symbol)
);
create index if not exists rules_user_bucket_idx on portfolio.rules (user_id, bucket_id);

create table if not exists portfolio.manual_assets (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  bucket_id uuid,
  name text not null check (length(btrim(name)) between 1 and 100),
  value_krw numeric(24, 2) not null check (value_krw >= 0),
  updated_at timestamptz not null default now(),
  constraint manual_assets_bucket_owner_fkey
    foreign key (user_id, bucket_id) references portfolio.buckets (user_id, id)
    on delete set null (bucket_id)
);
create index if not exists manual_assets_user_bucket_idx on portfolio.manual_assets (user_id, bucket_id);

create table if not exists portfolio.snapshots (
  user_id text not null references public."User"("userId") on delete cascade,
  snapshot_date date not null,
  bucket_key text not null,
  bucket_name text not null,
  value_krw numeric(24, 2) not null check (value_krw >= 0),
  target_percent numeric(5, 2),
  captured_at timestamptz not null default now(),
  primary key (user_id, snapshot_date, bucket_key)
);
create index if not exists snapshots_user_bucket_date_idx on portfolio.snapshots (user_id, bucket_key, snapshot_date desc);

alter table portfolio.plans enable row level security;
alter table portfolio.buckets enable row level security;
alter table portfolio.manual_assets enable row level security;
alter table portfolio.rules enable row level security;
alter table portfolio.snapshots enable row level security;
revoke all on portfolio.plans, portfolio.buckets, portfolio.manual_assets, portfolio.rules, portfolio.snapshots from public, anon, authenticated;
