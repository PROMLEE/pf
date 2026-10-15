alter table portfolio.manual_assets add column account_id uuid;
alter table portfolio.manual_assets add constraint manual_assets_account_owner_fkey
 foreign key (user_id,account_id) references portfolio.accounts(user_id,id);
create index manual_assets_owner_account_idx on portfolio.manual_assets(user_id,account_id);
alter table portfolio.plans add column cash_revision bigint not null default 0;
create table portfolio.cash_transfers (
 id uuid not null,
 user_id text not null references public."User"("userId") on delete cascade,
 source_id uuid not null,
 destination_id uuid not null,
 source_name text not null,
 destination_name text not null,
 currency text not null check(currency in ('KRW','USD')),
 amount numeric(24,6) not null check(amount>0),
 note text not null default '',
 created_at timestamptz not null default now(),
 primary key(user_id,id),
 check(source_id<>destination_id)
);
create index cash_transfers_owner_time_idx on portfolio.cash_transfers(user_id,created_at desc);
alter table portfolio.cash_transfers enable row level security;
revoke all on portfolio.cash_transfers from public,anon,authenticated;
