create table portfolio.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public."User"("userId") on delete cascade,
 endpoint text not null unique check (length(endpoint) between 1 and 2048),
 p256dh text not null,
 auth text not null,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 last_test_at timestamptz
);
create index push_subscriptions_owner on portfolio.push_subscriptions(user_id);
create table portfolio.push_campaigns (
 announcement_id uuid primary key references portfolio.announcements(id),
 requested_at timestamptz not null default now(),
 expanded_at timestamptz
);
create table portfolio.push_deliveries (
 announcement_id uuid not null references portfolio.push_campaigns(announcement_id),
 subscription_id uuid not null references portfolio.push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check (state in ('pending','sent','failed','skipped')),
 attempts int not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 last_status int,
 primary key (announcement_id,subscription_id)
);
create index push_delivery_pending on portfolio.push_deliveries(next_attempt_at) where state='pending';
alter table portfolio.push_subscriptions enable row level security;
alter table portfolio.push_campaigns enable row level security;
alter table portfolio.push_deliveries enable row level security;
revoke all on portfolio.push_subscriptions,portfolio.push_campaigns,portfolio.push_deliveries from public,anon,authenticated;
