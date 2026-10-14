import { NextResponse } from "next/server";
import { cronAuthorized, dispatchPush, pushConfig } from "../../../../lib/push";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const config = await pushConfig();
    if (
      !config ||
      !cronAuthorized(request.headers.get("authorization"), config.cronSecret)
    )
      return NextResponse.json(
        { message: "허용되지 않은 요청입니다." },
        { status: 401 },
      );
    return NextResponse.json(await dispatchPush());
  } catch {
    return NextResponse.json(
      { message: "알림 처리에 실패했습니다." },
      { status: 500 },
    );
  }
}
