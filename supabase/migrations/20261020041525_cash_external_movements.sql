-- Existing account transfers keep their behavior. External movements have one endpoint.
alter table portfolio.cash_transfers add column kind text not null default 'transfer';
alter table portfolio.cash_transfers add column fx_rate numeric(16,6);
alter table portfolio.cash_transfers alter column source_id drop not null;
alter table portfolio.cash_transfers alter column destination_id drop not null;
alter table portfolio.cash_transfers add constraint cash_movement_endpoints check (
 (kind='transfer' and source_id is not null and destination_id is not null and source_id<>destination_id)
 or (kind='deposit' and source_id is null and destination_id is not null)
 or (kind='withdrawal' and source_id is not null and destination_id is null)
);
alter table portfolio.cash_transfers add constraint cash_movement_fx check (fx_rate is null or (kind='deposit' and currency='USD' and fx_rate between 100 and 100000));
-- Same private schema, ownership-scoped server queries and no public grants.
alter table portfolio.cash_transfers enable row level security;
revoke all on portfolio.cash_transfers from public,anon,authenticated;
