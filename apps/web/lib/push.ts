import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { pushSubscriptionInput } from "./push-validation";

type Config = { publicKey: string; privateKey: string; cronSecret: string };
let configCache: { expires: number; value: Config | null } | undefined;
export async function pushConfig(): Promise<Config | null> {
  if (configCache && configCache.expires > Date.now()) return configCache.value;
  const result = await db().query<{ name: string; decrypted_secret: string }>(
    `select name,decrypted_secret from vault.decrypted_secrets where name in ('portrhythm_push_public','portrhythm_push_private','portrhythm_push_cron')`,
  );
  const keys = new Map(result.rows.map((r) => [r.name, r.decrypted_secret]));
  const value =
    keys.get("portrhythm_push_public") &&
    keys.get("portrhythm_push_private") &&
    keys.get("portrhythm_push_cron")
      ? {
          publicKey: keys.get("portrhythm_push_public")!,
          privateKey: keys.get("portrhythm_push_private")!,
          cronSecret: keys.get("portrhythm_push_cron")!,
        }
      : null;
  configCache = { expires: Date.now() + 60000, value };
  return value;
}
export function cronAuthorized(header: string | null, secret: string) {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    received = Buffer.from(header);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url: string; tag: string },
) {
  const valid = pushSubscriptionInput({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  });
  if (!valid)
    throw Object.assign(new Error("Invalid subscription"), { statusCode: 410 });
  const config = await pushConfig();
  if (!config) throw new Error("Push unavailable");
  // Always HTTPS allowlisted endpoints. No client-provided fetch target or URL in payload.
  return webpush.sendNotification(valid, JSON.stringify(payload), {
    vapidDetails: {
      subject: "https://pf.promleeblog.com/about",
      publicKey: config.publicKey,
      privateKey: config.privateKey,
    },
    TTL: 3600,
    timeout: 8000,
    topic: payload.tag.slice(0, 32),
    urgency: "normal",
  });
}
export async function dispatchPush() {
  if (!(await pushConfig())) return { ready: false, processed: 0 };
  const client = await db().connect();
  try {
    await client.query("begin");
    const campaigns = await client.query<{
      announcement_id: string;
      requested_at: string;
    }>(
      `select c.announcement_id,c.requested_at from portfolio.push_campaigns c join portfolio.announcements a on a.id=c.announcement_id where c.expanded_at is null and a.status='published' and (a.starts_at is null or a.starts_at<=now()) and (a.ends_at is null or a.ends_at>now()) order by c.requested_at limit 10 for update of c skip locked`,
    );
    for (const c of campaigns.rows) {
      await client.query(
        `insert into portfolio.push_deliveries(announcement_id,subscription_id) select $1,id from portfolio.push_subscriptions where enabled on conflict do nothing`,
        [c.announcement_id],
      );
      await client.query(
        `update portfolio.push_campaigns set expanded_at=now() where announcement_id=$1`,
        [c.announcement_id],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  await db().query(
    `update portfolio.push_deliveries set state='failed' where state='pending' and attempts>=5 and (lease_until is null or lease_until<now())`,
  );
  await db().query(
    `update portfolio.push_deliveries d set state='skipped' from portfolio.announcements a,portfolio.push_subscriptions s where d.announcement_id=a.id and d.subscription_id=s.id and d.state='pending' and (a.status!='published' or (a.ends_at is not null and a.ends_at<=now()) or not s.enabled)`,
  );
  const claimed = await db().query<{
    announcement_id: string;
    subscription_id: string;
    attempts: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `with picked as (select d.announcement_id,d.subscription_id from portfolio.push_deliveries d join portfolio.announcements a on a.id=d.announcement_id where d.state='pending' and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now()) and d.attempts<5 and a.status='published' and (a.starts_at is null or a.starts_at<=now()) and (a.ends_at is null or a.ends_at>now()) order by d.next_attempt_at limit 20 for update of d skip locked), claimed as (update portfolio.push_deliveries d set lease_until=now()+interval '2 minutes',attempts=d.attempts+1 from picked p where d.announcement_id=p.announcement_id and d.subscription_id=p.subscription_id returning d.*) select c.*,s.endpoint,s.p256dh,s.auth from claimed c join portfolio.push_subscriptions s on s.id=c.subscription_id`,
  );
  for (let i = 0; i < claimed.rows.length; i += 5)
    await Promise.all(
      claimed.rows.slice(i, i + 5).map(async (delivery) => {
        try {
          const visible = await db().query<{ title: string }>(
            `select a.title from portfolio.announcements a join portfolio.push_subscriptions s on s.id=$2 where a.id=$1 and a.status='published' and (a.starts_at is null or a.starts_at<=now()) and (a.ends_at is null or a.ends_at>now()) and s.enabled`,
            [delivery.announcement_id, delivery.subscription_id],
          );
          if (!visible.rows[0]) {
            await db().query(
              `update portfolio.push_deliveries set state='skipped',lease_until=null where announcement_id=$1 and subscription_id=$2`,
              [delivery.announcement_id, delivery.subscription_id],
            );
            return;
          }
          await sendPush(delivery, {
            title: "PortRhythm · 새 공지",
            body: visible.rows[0].title.slice(0, 120),
            url: `/?notice=${delivery.announcement_id}`,
            tag: delivery.announcement_id.replaceAll("-", ""),
          });
          await db().query(
            `update portfolio.push_deliveries set state='sent',lease_until=null,last_status=201 where announcement_id=$1 and subscription_id=$2`,
            [delivery.announcement_id, delivery.subscription_id],
          );
        } catch (error) {
          const status =
            Number((error as { statusCode?: number }).statusCode) || 0;
          const gone = status === 404 || status === 410;
          if (gone)
            await db().query(
              `update portfolio.push_subscriptions set enabled=false where id=$1`,
              [delivery.subscription_id],
            );
          await db().query(
            `update portfolio.push_deliveries set state=$3,lease_until=null,last_status=$4,next_attempt_at=now()+($5*interval '1 minute') where announcement_id=$1 and subscription_id=$2`,
            [
              delivery.announcement_id,
              delivery.subscription_id,
              gone ? "skipped" : delivery.attempts >= 5 ? "failed" : "pending",
              status,
              2 ** delivery.attempts,
            ],
          );
        }
      }),
    );
  return { ready: true, processed: claimed.rows.length };
}
