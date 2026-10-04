import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { fetchUsdKrwReference } from "../../../../lib/fx";
import { listPortfolio, updateAutomaticFx } from "../../../../lib/portfolio-db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host"))
        return NextResponse.json(
          { message: "허용되지 않은 요청입니다" },
          { status: 403 },
        );
    } catch {
      return NextResponse.json(
        { message: "허용되지 않은 요청입니다" },
        { status: 403 },
      );
    }
  }
  try {
    const portfolio = await listPortfolio(userId);
    if (!portfolio || portfolio.usdKrwMode !== "auto")
      return NextResponse.json({ fx: null });
    const reference = await fetchUsdKrwReference();
    const updated = await updateAutomaticFx(
      userId,
      reference.rate,
      reference.date,
    );
    return NextResponse.json({
      fx: updated
        ? {
            rate: reference.rate,
            rateDate: reference.date,
            updatedAt: new Date().toISOString(),
          }
        : {
            rate: portfolio.usdKrw,
            rateDate: portfolio.usdKrwRateDate,
            updatedAt: portfolio.usdKrwUpdatedAt,
          },
    });
  } catch {
    return NextResponse.json(
      { message: "환율 갱신에 실패했습니다. 마지막 저장 환율을 사용합니다." },
      { status: 502 },
    );
  }
}
