-- Add a nullable per-coin KRW purchase price without changing existing holdings.
alter table portfolio.crypto_assets
  add column if not exists average_cost_krw numeric(24, 8)
  check (average_cost_krw > 0);
