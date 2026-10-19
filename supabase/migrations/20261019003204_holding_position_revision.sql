-- Quote refreshes must not invalidate an in-progress holding trade.
-- Preserve an existing xmin token at migration time; new rows start at 1.
alter table portfolio.holdings add column position_revision bigint;
update portfolio.holdings set position_revision = xmin::text::bigint;
alter table portfolio.holdings alter column position_revision set default 1;
alter table portfolio.holdings alter column position_revision set not null;
alter table portfolio.holdings add constraint holdings_position_revision_positive check(position_revision > 0);

create function portfolio.bump_holding_position_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.id,new.user_id,new.quantity,new.average_cost,new.average_cost_krw,
         new.market,new.symbol,new.exchange_code,new.account_id,new.bucket_id,new.assignment_source)
     is distinct from
     row(old.id,old.user_id,old.quantity,old.average_cost,old.average_cost_krw,
         old.market,old.symbol,old.exchange_code,old.account_id,old.bucket_id,old.assignment_source) then
    new.position_revision := old.position_revision + 1;
  else
    new.position_revision := old.position_revision;
  end if;
  return new;
end;
$$;
revoke all on function portfolio.bump_holding_position_revision() from public, anon, authenticated;
create trigger holdings_position_revision
before update on portfolio.holdings
for each row execute function portfolio.bump_holding_position_revision();
