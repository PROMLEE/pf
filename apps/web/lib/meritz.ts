import { networkInterfaces } from "node:os";
import { meritzToken, meritzBase, meritzConfigured } from "./meritz-auth";
import { meritzPositions, meritzNumber } from "../app/meritz-model";
export function meritzAvailable(userId: string) {
  return (
    meritzConfigured() &&
    Boolean(process.env.MERITZ_USER_ID) &&
    process.env.MERITZ_USER_ID === userId
  );
}
function mac() {
  const configured = process.env.MERITZ_MAC_ADDRESS;
  if (configured && /^[0-9A-Fa-f]{12}$/.test(configured))
    return configured.toUpperCase();
  if (configured) throw Error("메리츠 호출 단말 설정을 확인해 주세요.");
  const address = Object.values(networkInterfaces())
    .flat()
    .find((row) => row && !row.internal && row.mac !== "00:00:00:00:00:00")
    ?.mac.replaceAll(":", "")
    .toUpperCase();
  if (!address)
    throw Error("이 실행 환경에서 메리츠 호출 단말을 확인할 수 없습니다.");
  return address;
}
export async function meritzGet(
  path: string,
  params: Record<string, string> = {},
) {
  // No arbitrary proxy or trading endpoints.
  if (
    ![
      "/accounts/v1/me/holdings",
      "/accounts/v1/me/overseas/holdings",
      "/accounts/v1/me/deposit",
      "/accounts/v1/me/overseas/currencies",
    ].includes(path)
  )
    throw Error("지원하지 않는 잔고 조회입니다.");
  const token = await meritzToken();
  const response = await fetch(
    `${meritzBase()}${path}?${new URLSearchParams(params)}`,
    {
      headers: { authorization: `Bearer ${token}`, mac_address: mac() },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = await response.json();
  if (
    !response.ok ||
    !["5766", "5820"].includes(body?.rsp_cd) ||
    (body.rsp_cd === "5766" && body.data == null)
  )
    throw Error(
      "메리츠 잔고를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  return body;
}
async function pages(path: string, params: Record<string, string> = {}) {
  const rows: Record<string, unknown>[] = [],
    seen = new Set<string>();
  for (let page = 0; page < 30; page++) {
    const result = await meritzGet(path, params);
    if (result.rsp_cd === "5820" && !result.data) return rows;
    if (!Array.isArray(result.data))
      throw Error("메리츠 잔고 목록을 확인할 수 없습니다.");
    rows.push(...result.data);
    if (result.tr_cont === "0") return rows;
    if (
      result.tr_cont !== "1" ||
      typeof result.tr_cont_key !== "string" ||
      !result.tr_cont_key ||
      seen.has(result.tr_cont_key)
    )
      throw Error("잔고 전체를 받지 못했습니다. 다시 불러와 주세요.");
    seen.add(result.tr_cont_key);
    params = { ...params, tr_cont: "1", tr_cont_key: result.tr_cont_key };
  }
  throw Error("조회 가능한 잔고 개수를 초과했습니다.");
}
export async function fetchMeritzBalance() {
  // Sequential requests keep the beta service's request load small.
  const domestic = await pages("/accounts/v1/me/holdings", {
    nthn_rmnd_incu_yn: "N",
  });
  const overseas = await pages("/accounts/v1/me/overseas/holdings");
  const deposit = await meritzGet("/accounts/v1/me/deposit");
  const currencies = await pages("/accounts/v1/me/overseas/currencies");
  const result = meritzPositions(domestic, overseas);
  const usdRows = currencies.filter((row) => row.crcd === "USD");
  if (usdRows.length > 1)
    throw Error("달러 잔고가 여러 건으로 조회되었습니다.");
  return {
    ...result,
    fetchedAt: new Date().toISOString(),
    cash: {
      KRW: meritzNumber(deposit.data?.d2_aft_tfam),
      USD: usdRows.length ? meritzNumber(usdRows[0].estm_frcr_amt) : 0,
    },
  };
}
