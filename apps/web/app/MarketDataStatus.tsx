"use client";
import { useEffect, useState } from "react";
type Status = {
  primary: "kis" | "toss" | null;
  available: ("kis" | "toss")[];
  fallback: boolean;
};
const names = { kis: "한국투자증권", toss: "토스증권" };
export default function MarketDataStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/market-data/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw Error("시세 공급자 설정을 확인하지 못했습니다.");
        return response.json() as Promise<Status>;
      })
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section aria-labelledby="stock-data-title">
      <h2 id="stock-data-title">주식 시세 공급자</h2>
      <p>
        {error ||
          (status
            ? status.primary
              ? `${names[status.primary]} 우선 조회`
              : "설정된 주식 시세 공급자가 없습니다."
            : "설정 확인 중…")}
      </p>
      {status?.primary && (
        <p>
          {status.fallback && status.available.length > 1
            ? `조회 실패 시 ${status.available
                .filter((provider) => provider !== status.primary)
                .map((provider) => names[provider])
                .join(" · ")}에서 다시 확인합니다.`
            : "현재 연결된 공급자의 시세를 사용합니다."}
        </p>
      )}
    </section>
  );
}
