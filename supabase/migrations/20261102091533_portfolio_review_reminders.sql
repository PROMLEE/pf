-- Opt-in only. NextAuth server routes scope every operation to their session owner.
create table portfolio.review_preferences (
 user_id text primary key references public."User"("userId") on delete cascade,
 monthly boolean not null default false,
 day smallint not null default 1 check(day between 1 and 28),
 quarterly boolean not null default false,
 threshold boolean not null default false,
 next_monthly timestamptz,
 next_quarterly timestamptz,
 last_reviewed timestamptz,
 observed_at timestamptz,
 outside boolean,
 last_threshold timestamptz,
 last_band_check timestamptz,
 updated_at timestamptz not null default now()
);
create index review_monthly_due on portfolio.review_preferences(next_monthly) where monthly;
create index review_quarterly_due on portfolio.review_preferences(next_quarterly) where quarterly;
create table portfolio.review_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references portfolio.review_preferences(user_id) on delete cascade,
 subscription_id uuid not null references portfolio.push_subscriptions(id) on delete cascade,
 kind text not null check(kind in ('monthly','quarterly','threshold')),
 period text not null check(period ~ '^\d{4}-\d{2}-\d{2}$'),
 state text not null default 'pending' check(state in ('pending','sent','failed','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 last_status integer,
 expires_at timestamptz not null,
 observed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(subscription_id,kind,period)
);
create index review_delivery_pending on portfolio.review_deliveries(next_attempt_at) where state='pending';
create index review_delivery_owner on portfolio.review_deliveries(user_id);
alter table portfolio.review_preferences enable row level security;
alter table portfolio.review_deliveries enable row level security;
revoke all on portfolio.review_preferences,portfolio.review_deliveries from public,anon,authenticated;
-- Retain the existing announcement job and its Vault authentication. No keys in SQL.
select cron.schedule('portrhythm-push-dispatch', '* * * * *', $job$
 select net.http_post(
  url := 'https://pf.promleeblog.com/api/push/dispatch',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='portrhythm_push_cron')),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
 ) where exists (
  select 1 from portfolio.push_campaigns c join portfolio.announcements a on a.id=c.announcement_id
  where a.status='published' and (a.starts_at is null or a.starts_at<=now()) and (a.ends_at is null or a.ends_at>now())
  and (c.expanded_at is null or exists (select 1 from portfolio.push_deliveries d where d.announcement_id=c.announcement_id and d.state='pending' and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now())))
 ) or exists (
  select 1 from portfolio.push_deliveries d join portfolio.announcements a on a.id=d.announcement_id join portfolio.push_subscriptions s on s.id=d.subscription_id
  where d.state='pending' and (d.lease_until is null or d.lease_until<now()) and (a.status!='published' or (a.ends_at is not null and a.ends_at<=now()) or not s.enabled)
 ) or exists (
  select 1 from portfolio.review_preferences r where exists(select 1 from portfolio.push_subscriptions s where s.user_id=r.user_id and s.enabled)
  and ((r.monthly and r.next_monthly<=now()) or (r.quarterly and r.next_quarterly<=now()) or
   (r.threshold and r.observed_at>now()-interval '24 hours' and extract(hour from now() at time zone 'Asia/Seoul')>=9
    and (r.last_band_check is null or (r.last_band_check at time zone 'Asia/Seoul')::date<(now() at time zone 'Asia/Seoul')::date)))
 ) or exists (
  select 1 from portfolio.review_deliveries d where d.state='pending' and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now())
 );
$job$);
