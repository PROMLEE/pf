-- Server-only encrypted provider tokens. Never expose through the Data API.
create table portfolio.market_data_tokens (
 cache_key text primary key check(length(cache_key)=64),
 token_ciphertext text not null,
 expires_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table portfolio.market_data_tokens enable row level security;
revoke all on portfolio.market_data_tokens from public,anon,authenticated;
comment on table portfolio.market_data_tokens is 'Encrypted server-only market data tokens, serialized across instances with advisory locks';
