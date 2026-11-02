import { NextResponse } from "next/server";
import { currentUserId } from "../../../../../lib/auth";
import { sameOrigin } from "../../../../../lib/admin";
import { db } from "../../../../../lib/db";
import { withinTolerance } from "../../../../rebalance";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  let rows: { id: string; percent: number }[];
  try {
    const data = await request.json();
    rows = data.weights;
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      !rows.length ||
      rows.some(
        (r) =>
          typeof r.id !== "string" ||
          typeof r.percent !== "number" ||
          !Number.isFinite(r.percent) ||
          r.percent < 0 ||
          r.percent > 100,
      ) ||
      new Set(rows.map((r) => r.id)).size !== rows.length ||
      Math.abs(rows.reduce((sum, r) => sum + r.percent, 0) - 100) > 0.01
    )
      throw Error();
  } catch {
    return NextResponse.json(
      { message: "비중 정보를 확인해 주세요." },
      { status: 400 },
    );
  }
  try {
    const result = await db().query<{
      id: string;
      target_percent: string;
      tolerance_percent: string;
      tolerance_mode: string;
      relative_tolerance_percent: string;
    }>(
      `select b.id,b.target_percent,p.tolerance_percent,p.tolerance_mode,p.relative_tolerance_percent
      from portfolio.buckets b join portfolio.plans p on p.user_id=b.user_id join portfolio.review_preferences r on r.user_id=b.user_id
      where b.user_id=$1 and r.threshold`,
      [user],
    );
    if (
      Math.abs(
        result.rows.reduce((sum, b) => sum + Number(b.target_percent), 0) - 100,
      ) > 0.01 ||
      result.rows.length !== rows.length ||
      result.rows.some((b) => !rows.some((r) => r.id === b.id))
    )
      return NextResponse.json({ observed: false });
    const outside = result.rows.some(
      (b) =>
        !withinTolerance(
          Number(b.target_percent),
          rows.find((r) => r.id === b.id)!.percent,
          b.tolerance_mode === "relative"
            ? (Number(b.target_percent) *
                Number(b.relative_tolerance_percent)) /
                100
            : Number(b.tolerance_percent),
        ),
    );
    await db().query(
      `update portfolio.review_preferences set outside=$2,observed_at=now() where user_id=$1 and threshold
      and (observed_at is null or observed_at<now()-interval '1 minute' or outside is distinct from $2)`,
      [user, outside],
    );
    return NextResponse.json({ observed: true });
  } catch {
    return NextResponse.json(
      { message: "비중 점검을 기록하지 못했습니다." },
      { status: 500 },
    );
  }
}
