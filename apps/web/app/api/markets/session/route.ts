import { currentUserId } from "../../../../lib/auth";
import { domesticTradingDay } from "../../../../lib/market-calendar";
import { marketLocalTime, marketSessions } from "../../../market-sessions";

export const runtime = "nodejs";
export async function GET() {
  if (!await currentUserId()) return Response.json({message:"로그인이 필요합니다"},{status:401});
  const now = new Date();
  const kr = marketLocalTime(now,"KR");
  // Do not spend an API request on days/times with no domestic regular session.
  const day = !kr.weekend && kr.minutes >= 9*60 && kr.minutes < 15*60+30
    ? await domesticTradingDay(kr.date) : null;
  return Response.json(marketSessions(new Date(),day),{headers:{"Cache-Control":"private, no-store"}});
}
