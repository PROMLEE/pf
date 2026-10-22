import { NextResponse } from "next/server";
import { currentUserId } from "../../../../../lib/auth";
import { sameOrigin } from "../../../../../lib/admin";
import { meritzAvailable } from "../../../../../lib/meritz";
import {
  meritzSyncStatus,
  setMeritzSyncEnabled,
  syncMeritzBalance,
  configureMeritzSync,
  disconnectMeritzSync,
} from "../../../../../lib/meritz-sync";
import { MeritzImportError } from "../../../../../lib/meritz-import";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const user = await currentUserId();
  if (!user || !meritzAvailable(user)) return json({ available: false });
  try {
    return json(await meritzSyncStatus(user));
  } catch {
    return json(
      { available: true, error: "동기화 설정을 불러오지 못했습니다." },
      503,
    );
  }
}
async function handle(request: Request, settings: boolean) {
  const user = await currentUserId();
  if (!user) return json({ message: "로그인이 필요합니다." }, 401);
  if (!sameOrigin(request) || !meritzAvailable(user))
    return json({ message: "접근할 수 없습니다." }, 403);
  try {
    if (!settings) return json(await syncMeritzBalance(user));
    const body = await request.json();
    if (body?.action === "disconnect")
      return json(await disconnectMeritzSync(user));
    if (
      body?.action === "configure" &&
      [body.accountId, body.krwAssetId, body.usdAssetId].every(
        (id) =>
          typeof id === "string" &&
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
      )
    )
      return json(
        await configureMeritzSync(
          user,
          body.accountId,
          body.krwAssetId,
          body.usdAssetId,
        ),
      );
    if (typeof body?.enabled !== "boolean")
      return json({ message: "설정을 확인해 주세요." }, 400);
    return json(await setMeritzSyncEnabled(user, body.enabled));
  } catch (e) {
    return json(
      {
        message:
          e instanceof MeritzImportError
            ? e.message
            : "동기화 요청을 처리하지 못했습니다.",
      },
      e instanceof MeritzImportError ? e.status : 503,
    );
  }
}
export const POST = (request: Request) => handle(request, false);
export const PATCH = (request: Request) => handle(request, true);
