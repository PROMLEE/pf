create table portfolio.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."User"("userId") on delete cascade,
  broker text not null check (length(btrim(broker)) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id)
);
create unique index accounts_owner_label_idx on portfolio.accounts(user_id,lower(broker),lower(name));
alter table portfolio.accounts enable row level security;
revoke all on portfolio.accounts from public,anon,authenticated;

insert into portfolio.accounts(user_id,broker,name)
select user_id,min(broker),min(account_label) from portfolio.holdings
 group by user_id,lower(broker),lower(account_label);
alter table portfolio.holdings add column account_id uuid;
update portfolio.holdings h set account_id=a.id from portfolio.accounts a
where a.user_id=h.user_id and lower(a.broker)=lower(h.broker) and lower(a.name)=lower(h.account_label);
alter table portfolio.holdings add constraint holdings_account_owner_fkey
 foreign key(user_id,account_id) references portfolio.accounts(user_id,id);

-- Keep existing capture/import clients compatible; account metadata has one owner.
create function portfolio.link_holding_account() returns trigger
language plpgsql security invoker set search_path='' as $$
declare linked portfolio.accounts%rowtype;
begin
  if new.account_id is null then
    insert into portfolio.accounts(user_id,broker,name) values(new.user_id,new.broker,new.account_label)
    on conflict(user_id,lower(broker),lower(name)) do update set updated_at=portfolio.accounts.updated_at
    returning * into linked;
  else
    select * into linked from portfolio.accounts where user_id=new.user_id and id=new.account_id for update;
    if not found then raise exception 'Account does not belong to holding owner' using errcode='23503'; end if;
  end if;
  new.account_id=linked.id; new.broker=linked.broker; new.account_label=linked.name;
  return new;
end;
$$;
revoke all on function portfolio.link_holding_account() from public,anon,authenticated;
create trigger link_holding_account before insert or update of broker,account_label,account_id on portfolio.holdings
for each row execute function portfolio.link_holding_account();
alter table portfolio.holdings alter column account_id set not null;
create index holdings_owner_account_idx on portfolio.holdings(user_id,account_id);
