alter table portfolio.plans
  add column tolerance_mode text not null default 'percentage-points'
    check (tolerance_mode in ('percentage-points', 'relative')),
  add column relative_tolerance_percent numeric not null default 10
    check (relative_tolerance_percent >= 0 and relative_tolerance_percent <= 100);

comment on column portfolio.plans.tolerance_mode is 'Rebalance band: absolute percentage points or percent of each target value';
comment on column portfolio.plans.relative_tolerance_percent is 'Allowed deviation as a percent of each portfolio target value; existing percentage point setting is preserved';
