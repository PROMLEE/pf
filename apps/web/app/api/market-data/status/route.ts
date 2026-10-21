import { currentUserId } from "../../../../lib/auth";
import { stockDataStatus } from "../../../../lib/stock-data";
export const runtime = "nodejs";
export async function GET() {
  if (!(await currentUserId()))
    return Response.json({ message: "로그인이 필요합니다" }, { status: 401 });
  try {
    const { primary, available, fallback } = stockDataStatus();
    return Response.json(
      { primary, available, fallback },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { message: "시세 공급자 설정을 확인해 주세요." },
      { status: 503 },
    );
  }
}
