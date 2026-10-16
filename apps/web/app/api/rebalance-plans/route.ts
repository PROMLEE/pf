import { currentUserId } from "../../../lib/auth";
import {
  listRebalanceRuns,
  startRebalanceRun,
  cancelRebalanceRun,
  executeRebalanceItem,
} from "../../../lib/rebalance-runs-db";
import {
  validRunConfig,
  validRunExecution,
  isRunId,
  RunError,
} from "../../rebalance-runs";
import { PositionTradeError } from "../../position-trade";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e6)
    return Response.json(
      { message: "목록 범위를 확인하세요." },
      { status: 400 },
    );
  try {
    return Response.json(await listRebalanceRuns(userId, offset), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { message: "계획 이력을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return Response.json({ message: "로그인이 필요합니다." }, { status: 401 });
  try {
    if (
      new URL(request.headers.get("origin") ?? "").host !==
      request.headers.get("host")
    )
      return Response.json(
        { message: "허용되지 않은 요청입니다." },
        { status: 403 },
      );
  } catch {
    return Response.json(
      { message: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  }
  try {
    const text = await request.text();
    if (text.length > 250000) throw new RunError("요청이 너무 큽니다.");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RunError("입력을 확인하세요.");
    }
    if (!body || typeof body !== "object")
      throw new RunError("입력을 확인하세요.");
    if (
      body.action === "start" &&
      isRunId(body.id) &&
      validRunConfig(body.config)
    )
      return Response.json({
        run: await startRebalanceRun(userId, body.id, body.config),
      });
    if (
      body.action === "cancel" &&
      isRunId(body.id) &&
      Number.isSafeInteger(body.revision) &&
      body.revision >= 0
    ) {
      await cancelRebalanceRun(userId, body.id, body.revision);
      return Response.json({ ok: true });
    }
    if (body.action === "execute" && validRunExecution(body.execution))
      return Response.json(await executeRebalanceItem(userId, body.execution));
    throw new RunError("계획·거래 입력을 확인하세요.");
  } catch (e) {
    return Response.json(
      {
        message:
          e instanceof RunError || e instanceof PositionTradeError
            ? e.message
            : "계획을 저장하지 못했습니다.",
      },
      {
        status:
          e instanceof RunError || e instanceof PositionTradeError
            ? e.status
            : 500,
      },
    );
  }
}
