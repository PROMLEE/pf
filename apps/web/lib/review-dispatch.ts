import { db } from "./db";
import {
  nextReview,
  reviewDate,
  reviewPayload,
  type ReviewKind,
} from "../app/review-schedule";
import type { ReviewRow } from "./review-db";
type Sender = (
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: ReturnType<typeof reviewPayload>,
) => Promise<unknown>;
export async function dispatchReviewReminders(send: Sender, now = new Date()) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const due = await client.query<ReviewRow>(
      `select r.* from portfolio.review_preferences r
      where exists(select 1 from portfolio.push_subscriptions s where s.user_id=r.user_id and s.enabled)
      and ((r.monthly and r.next_monthly<=$1) or (r.quarterly and r.next_quarterly<=$1)
        or (r.threshold and r.observed_at>$1::timestamptz-interval '24 hours'
          and (r.last_band_check is null or (r.last_band_check at time zone 'Asia/Seoul')::date<($1::timestamptz at time zone 'Asia/Seoul')::date)
          and extract(hour from $1::timestamptz at time zone 'Asia/Seoul')>=9))
      order by r.updated_at limit 20 for update of r skip locked`,
      [now],
    );
    for (const row of due.rows) {
      async function enqueue(kind: ReviewKind, period: string) {
        await client.query(
          `insert into portfolio.review_deliveries(user_id,subscription_id,kind,period,expires_at,observed_at)
          select $1,id,$2,$3,$4,$5 from portfolio.push_subscriptions where user_id=$1 and enabled
          on conflict(subscription_id,kind,period) do nothing`,
          [
            row.user_id,
            kind,
            period,
            new Date(
              now.getTime() + (kind === "threshold" ? 24 : 168) * 3600000,
            ),
            kind === "threshold" ? row.observed_at : null,
          ],
        );
      }
      if (row.monthly && row.next_monthly && row.next_monthly <= now) {
        if (
          now.getTime() - row.next_monthly.getTime() < 7 * 86400000 &&
          (!row.last_reviewed || row.last_reviewed < row.next_monthly)
        )
          await enqueue("monthly", reviewDate(row.next_monthly));
        await client.query(
          "update portfolio.review_preferences set next_monthly=$2 where user_id=$1",
          [row.user_id, nextReview("monthly", row.day, now)],
        );
      }
      if (row.quarterly && row.next_quarterly && row.next_quarterly <= now) {
        // A monthly and quarterly review on the same day needs one reminder.
        if (
          now.getTime() - row.next_quarterly.getTime() < 7 * 86400000 &&
          (!row.last_reviewed || row.last_reviewed < row.next_quarterly) &&
          !(
            row.monthly &&
            row.next_monthly &&
            reviewDate(row.next_monthly) === reviewDate(row.next_quarterly)
          )
        )
          await enqueue("quarterly", reviewDate(row.next_quarterly));
        await client.query(
          "update portfolio.review_preferences set next_quarterly=$2 where user_id=$1",
          [row.user_id, nextReview("quarterly", row.day, now)],
        );
      }
      if (row.threshold) {
        if (
          row.outside &&
          row.observed_at &&
          now.getTime() - row.observed_at.getTime() < 86400000 &&
          (!row.last_reviewed || row.last_reviewed < row.observed_at) &&
          (!row.last_threshold ||
            now.getTime() - row.last_threshold.getTime() >= 7 * 86400000)
        ) {
          await enqueue("threshold", reviewDate(now));
          await client.query(
            "update portfolio.review_preferences set last_threshold=$2 where user_id=$1",
            [row.user_id, now],
          );
        }
        await client.query(
          "update portfolio.review_preferences set last_band_check=$2 where user_id=$1",
          [row.user_id, now],
        );
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  await db()
    .query(`update portfolio.review_deliveries d set state='skipped',lease_until=null
    from portfolio.review_preferences r,portfolio.push_subscriptions s
    where d.user_id=r.user_id and d.subscription_id=s.id and d.state='pending'
    and (not s.enabled or d.expires_at<=now() or r.last_reviewed>=d.created_at
      or (d.kind='monthly' and not r.monthly) or (d.kind='quarterly' and not r.quarterly)
      or (d.kind='threshold' and (not r.threshold or not coalesce(r.outside,false) or r.observed_at<now()-interval '24 hours')))`);
  await db().query(
    `update portfolio.review_deliveries set state='failed',lease_until=null where state='pending' and attempts>=5 and (lease_until is null or lease_until<now())`,
  );
  const claimed = await db().query<{
    id: string;
    user_id: string;
    subscription_id: string;
    kind: ReviewKind;
    period: string;
    attempts: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(`with picked as (
    select id from portfolio.review_deliveries where state='pending' and attempts<5 and next_attempt_at<=now()
      and (lease_until is null or lease_until<now()) order by next_attempt_at limit 5 for update skip locked),
    claimed as (update portfolio.review_deliveries d set lease_until=now()+interval '2 minutes',attempts=attempts+1 from picked p where d.id=p.id returning d.*)
    select c.*,s.endpoint,s.p256dh,s.auth from claimed c join portfolio.push_subscriptions s on s.id=c.subscription_id`);
  await Promise.all(
    claimed.rows.map(async (delivery) => {
      try {
        // Recheck consent immediately before sending, including a concurrent opt-out/review completion.
        const consent = await db().query(
          `select 1 from portfolio.review_preferences r join portfolio.push_subscriptions s on s.user_id=r.user_id
        join portfolio.review_deliveries d on d.subscription_id=s.id and d.id=$2
        where r.user_id=$1 and s.enabled and d.expires_at>now() and (r.last_reviewed is null or r.last_reviewed<d.created_at)
        and ((d.kind='monthly' and r.monthly) or (d.kind='quarterly' and r.quarterly)
          or (d.kind='threshold' and r.threshold and r.outside and r.observed_at>now()-interval '24 hours'))`,
          [delivery.user_id, delivery.id],
        );
        if (!consent.rows.length) {
          await db().query(
            "update portfolio.review_deliveries set state='skipped',lease_until=null where id=$1",
            [delivery.id],
          );
          return;
        }
        await send(delivery, reviewPayload(delivery.kind, delivery.period));
        await db().query(
          "update portfolio.review_deliveries set state='sent',lease_until=null,last_status=201 where id=$1",
          [delivery.id],
        );
      } catch (e) {
        const status = Number((e as { statusCode?: number }).statusCode) || 0,
          gone = status === 404 || status === 410;
        if (gone)
          await db().query(
            "update portfolio.push_subscriptions set enabled=false where id=$1 and user_id=$2",
            [delivery.subscription_id, delivery.user_id],
          );
        await db().query(
          `update portfolio.review_deliveries set state=$2,lease_until=null,last_status=$3,next_attempt_at=now()+($4*interval '1 minute') where id=$1`,
          [
            delivery.id,
            gone ? "skipped" : delivery.attempts >= 5 ? "failed" : "pending",
            status,
            2 ** delivery.attempts,
          ],
        );
      }
    }),
  );
  return { processed: claimed.rows.length };
}
