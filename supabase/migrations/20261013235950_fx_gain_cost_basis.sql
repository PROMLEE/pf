-- Unknown historical costs remain NULL; enabling FX gains never fabricates a basis.
alter table portfolio.plans add column if not exists include_fx_gains boolean not null default false;
alter table portfolio.holdings add column if not exists average_cost_krw numeric(30,6) check (average_cost_krw > 0 and average_cost_krw < 1000000000000000);
alter table portfolio.manual_assets add column if not exists average_fx_rate numeric(12,6) check (average_fx_rate >= 100 and average_fx_rate <= 100000);
