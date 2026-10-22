import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { sameOrigin } from "../../../../lib/admin";
import { meritzAvailable } from "../../../../lib/meritz";
import {
  createMeritzPreview,
  applyMeritzPreview,
  MeritzImportError,
} from "../../../../lib/meritz-import";
export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function GET() {
  const user = await currentUserId();
  return NextResponse.json(
    { available: !!user && meritzAvailable(user) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  if (!sameOrigin(request) || !meritzAvailable(user))
    return NextResponse.json(
      { message: "이 계정에 연결된 메리츠 계좌가 없습니다." },
      { status: 403 },
    );
  try {
    if (Number(request.headers.get("content-length")) > 600000)
      throw new MeritzImportError("요청이 너무 큽니다.");
    const body = await request.json();
    let result;
    if (
      body?.action === "preview" &&
      typeof body.accountId === "string" &&
      uuid.test(body.accountId) &&
      [body.krwAssetId, body.usdAssetId].every(
        (id) =>
          typeof id === "string" &&
          (id === "skip" || id === "new" || uuid.test(id)),
      )
    )
      result = await createMeritzPreview(user, {
        accountId: body.accountId,
        krwAssetId: body.krwAssetId,
        usdAssetId: body.usdAssetId,
      });
    else if (
      body?.action === "apply" &&
      typeof body.token === "string" &&
      Array.isArray(body.selected) &&
      body.selected.every((s: unknown) => typeof s === "string")
    )
      result = await applyMeritzPreview(user, body.token, body.selected);
    else throw new MeritzImportError("불러오기 입력을 확인해 주세요.");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof MeritzImportError
            ? error.message
            : "메리츠 잔고를 처리하지 못했습니다. 서버 설정과 연결 상태를 확인해 주세요.",
      },
      { status: error instanceof MeritzImportError ? error.status : 502 },
    );
  }
}
