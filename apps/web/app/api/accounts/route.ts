import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import {
  createAccount,
  listAccounts,
  updateAccount,
} from "../../../lib/accounts-db";
import { listHoldings } from "../../../lib/holdings-db";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function allowed(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return !origin || new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
export async function GET() {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  try {
    return NextResponse.json({ accounts: await listAccounts(user) });
  } catch {
    return NextResponse.json(
      { message: "계좌를 불러오지 못했습니다" },
      { status: 500 },
    );
  }
}
async function mutate(request: Request, edit: boolean) {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!allowed(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    const body = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.broker !== "string" ||
      !body.broker.trim() ||
      body.broker.trim().length > 80 ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 120 ||
      (edit && (typeof body.id !== "string" || !uuid.test(body.id)))
    )
      return NextResponse.json(
        { message: "증권사와 계좌명을 확인해 주세요" },
        { status: 400 },
      );
    if (edit) {
      const result = await updateAccount(user, body.id, body.broker, body.name);
      return result
        ? NextResponse.json({ ...result, holdings: await listHoldings(user) })
        : NextResponse.json(
            { message: "계좌를 찾지 못했습니다" },
            { status: 404 },
          );
    }
    const account = await createAccount(user, body.broker, body.name);
    return NextResponse.json(
      { account, accounts: await listAccounts(user) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          (error as { code?: string })?.code === "23505"
            ? "같은 증권사에 동일한 계좌명이 있습니다"
            : "계좌를 저장하지 못했습니다",
      },
      { status: (error as { code?: string })?.code === "23505" ? 409 : 500 },
    );
  }
}
export const POST = (request: Request) => mutate(request, false);
export const PATCH = (request: Request) => mutate(request, true);
