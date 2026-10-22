create table portfolio.meritz_sync (
 user_id text primary key references public."User"("userId") on delete cascade,
 account_id uuid not null,
 krw_asset_id uuid not null references portfolio.manual_assets(id) deferrable initially deferred,
 usd_asset_id uuid not null references portfolio.manual_assets(id) deferrable initially deferred,
 key_hash text not null,
 enabled boolean not null default false,
 lease_id uuid,
 lease_until timestamptz,
 last_attempt_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 last_change_count integer not null default 0,
 updated_at timestamptz not null default now(),
 foreign key(user_id,account_id) references portfolio.accounts(user_id,id),
 check(krw_asset_id<>usd_asset_id)
);
alter table portfolio.meritz_sync enable row level security;
revoke all on portfolio.meritz_sync from public,anon,authenticated;
