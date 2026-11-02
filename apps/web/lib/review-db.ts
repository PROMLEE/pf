import { db } from "./db";
import {
  emptyReviewPreferences,
  nextReview,
  reviewDate,
  type ReviewPreferences,
} from "../app/review-schedule";
export type ReviewRow = {
  user_id: string;
  monthly: boolean;
  day: number;
  quarterly: boolean;
  threshold: boolean;
  next_monthly: Date | null;
  next_quarterly: Date | null;
  last_reviewed: Date | null;
  observed_at: Date | null;
  outside: boolean | null;
  last_threshold: Date | null;
  last_band_check: Date | null;
};
export function reviewFromRow(row?: ReviewRow): ReviewPreferences {
  return row
    ? {
        monthly: row.monthly,
        day: row.day,
        quarterly: row.quarterly,
        threshold: row.threshold,
        nextMonthly: row.next_monthly?.toISOString() ?? null,
        nextQuarterly: row.next_quarterly?.toISOString() ?? null,
        lastReviewed: row.last_reviewed?.toISOString() ?? null,
        observedAt: row.observed_at?.toISOString() ?? null,
        outside: row.outside,
      }
    : { ...emptyReviewPreferences };
}
export async function getReview(user: string) {
  const result = await db().query<ReviewRow>(
    "select * from portfolio.review_preferences where user_id=$1",
    [user],
  );
  return reviewFromRow(result.rows[0]);
}
export async function saveReview(
  user: string,
  input: Pick<ReviewPreferences, "monthly" | "day" | "quarterly" | "threshold">,
) {
  const now = new Date();
  const result = await db().query<ReviewRow>(
    `insert into portfolio.review_preferences(user_id,monthly,day,quarterly,threshold,next_monthly,next_quarterly)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(user_id) do update set
    next_monthly=case when not excluded.monthly then null when not review_preferences.monthly or review_preferences.day<>excluded.day then excluded.next_monthly else review_preferences.next_monthly end,
    next_quarterly=case when not excluded.quarterly then null when not review_preferences.quarterly then excluded.next_quarterly else review_preferences.next_quarterly end,
    observed_at=case when excluded.threshold=review_preferences.threshold then review_preferences.observed_at else null end,
    outside=case when excluded.threshold=review_preferences.threshold then review_preferences.outside else null end,
    monthly=excluded.monthly,day=excluded.day,quarterly=excluded.quarterly,threshold=excluded.threshold,updated_at=now() returning *`,
    [
      user,
      input.monthly,
      input.day,
      input.quarterly,
      input.threshold,
      input.monthly ? nextReview("monthly", input.day, now) : null,
      input.quarterly ? nextReview("quarterly", input.day, now) : null,
    ],
  );
  return reviewFromRow(result.rows[0]);
}
export async function completeReview(user: string) {
  const now = new Date(),
    afterToday = new Date(`${reviewDate(now)}T23:59:59.999+09:00`);
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into portfolio.review_preferences(user_id) values($1) on conflict do nothing",
      [user],
    );
    const current = await client.query<ReviewRow>(
      "select * from portfolio.review_preferences where user_id=$1 for update",
      [user],
    );
    const row = current.rows[0];
    const result = await client.query<ReviewRow>(
      `update portfolio.review_preferences set last_reviewed=$2,next_monthly=$3,next_quarterly=$4,updated_at=now() where user_id=$1 returning *`,
      [
        user,
        now,
        row.monthly ? nextReview("monthly", row.day, afterToday) : null,
        row.quarterly ? nextReview("quarterly", row.day, afterToday) : null,
      ],
    );
    await client.query("commit");
    return reviewFromRow(result.rows[0]);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
