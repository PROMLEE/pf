-- Applied to the existing MeetIntheMiddle Supabase project.
-- The schema is private; quote updates run through authenticated Next.js routes.
create table if not exists portfolio.crypto_assets (
  id uuid primary key,
  user_id text not null references public."User"("userId") on delete cascade,
  bucket_id uuid,
  market_code text not null check (market_code ~ '^KRW-[A-Z0-9]{2,20}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  quantity numeric(24, 12) not null check (quantity > 0),
  average_cost_krw numeric(24, 8) check (average_cost_krw > 0),
  quoted_price_krw numeric(24, 8) check (quoted_price_krw > 0),
  quote_checked_at timestamptz,
  last_trade_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_assets_bucket_owner_fkey
    foreign key (user_id, bucket_id) references portfolio.buckets (user_id, id)
    on delete set null (bucket_id),
  unique (user_id, market_code)
);
create index if not exists crypto_assets_user_bucket_idx
  on portfolio.crypto_assets (user_id, bucket_id);
alter table portfolio.crypto_assets enable row level security;
revoke all on portfolio.crypto_assets from public, anon, authenticated;
