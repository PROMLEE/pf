-- Supabase scheduler avoids Vercel Hobby's once-a-day Cron limitation.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
revoke all on schema net, cron from public, anon, authenticated;
revoke all on all tables in schema net, cron from public, anon, authenticated;
revoke execute on all functions in schema net, cron from public, anon, authenticated;
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
 );
$job$);
