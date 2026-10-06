-- Shared, server-only KIS token cache for local restarts and Vercel instances.
-- Token values are encrypted by the application before they reach the database.
create table if not exists portfolio.kis_token_cache (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  token_ciphertext text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table portfolio.kis_token_cache enable row level security;
revoke all on portfolio.kis_token_cache from public, anon, authenticated;
