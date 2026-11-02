"use client";
import { useEffect, useState } from "react";
import {
  emptyReviewPreferences,
  type ReviewPreferences,
} from "./review-schedule";
import styles from "./ReviewSettings.module.css";
const cache = new Map<
  string,
  { expires: number; request: Promise<ReviewPreferences> }
>();
async function load(user: string, force = false) {
  const old = cache.get(user);
  if (!force && old && old.expires > Date.now()) return old.request;
  const request = fetch("/api/push/review", { cache: "no-store" }).then(
    async (r) => {
      const d = await r.json();
      if (!r.ok) throw Error(d.message);
      return d.preferences as ReviewPreferences;
    },
  );
  cache.set(user, { expires: Date.now() + 60000, request });
  try {
    return await request;
  } catch (e) {
    cache.delete(user);
    throw e;
  }
}
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "기록 없음";
export default function ReviewSettings({
  userId,
  compact = false,
  onSettings,
  onDirty,
}: {
  userId: string;
  compact?: boolean;
  onSettings?: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<ReviewPreferences | null>(null),
    [draft, setDraft] = useState(emptyReviewPreferences),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void load(userId)
      .then((p) => {
        if (live) {
          setSaved(p);
          setDraft(p);
        }
      })
      .catch(() => {
        if (live) setMessage("점검 설정을 불러오지 못했습니다.");
      });
    return () => {
      live = false;
    };
  }, [userId]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void load(userId, true)
        .then((p) => {
          if (!live) return;
          setSaved((current) =>
            current
              ? { ...current, observedAt: p.observedAt, outside: p.outside }
              : p,
          );
          setDraft((current) => ({
            ...current,
            observedAt: p.observedAt,
            outside: p.outside,
          }));
        })
        .catch(() => {});
    };
    window.addEventListener("pf-review-observed", refresh);
    return () => {
      live = false;
      window.removeEventListener("pf-review-observed", refresh);
    };
  }, [userId]);
  const dirty =
    !!saved &&
    !compact &&
    ["monthly", "day", "quarterly", "threshold"].some(
      (k) =>
        draft[k as keyof ReviewPreferences] !==
        saved[k as keyof ReviewPreferences],
    );
  useEffect(() => {
    onDirty?.(dirty || busy);
    return () => onDirty?.(false);
  }, [dirty, busy, onDirty]);
  async function save(complete = false) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/push/review", {
        method: complete ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: complete ? "{}" : JSON.stringify(draft),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message);
      setSaved(data.preferences);
      setDraft(data.preferences);
      cache.delete(userId);
      window.dispatchEvent(new Event("pf-review-preferences"));
      setMessage(
        complete
          ? "오늘 점검 완료를 기록했습니다. 거래·잔고는 변경하지 않았습니다."
          : "점검일과 알림 설정을 저장했습니다.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const dates = [saved?.nextMonthly, saved?.nextQuarterly]
    .filter((x): x is string => !!x)
    .sort();
  if (compact)
    return (
      <section className={styles.compact} aria-label="정기 점검">
        <div>
          <strong>정기 점검</strong>
          <p>
            {saved
              ? dates.length
                ? `${Date.parse(dates[0]) < Date.now() ? "점검 예정일 지남" : "다음"} ${date(dates[0])} · 오전 9시`
                : "설정에서 월간·분기 점검일을 정할 수 있습니다."
              : "점검 설정 확인 중…"}
          </p>
          {saved?.lastReviewed && (
            <small>지난 점검 {date(saved.lastReviewed)}</small>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!saved || busy}
            onClick={() => void save(true)}
          >
            오늘 점검 완료
          </button>
          <button type="button" disabled={busy} onClick={onSettings}>
            점검 설정
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
    );
  return (
    <section
      className={styles.settings}
      aria-labelledby="review-settings-title"
    >
      <h2 id="review-settings-title">점검일·리밸런싱 알림</h2>
      <p>
        정한 날에 비중을 확인하고, 필요한 경우에만 조정하세요. 브라우저 알림을
        켠 기기로 발송합니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!saved || busy}>
          <div className={styles.option}>
            <label>
              <input
                type="checkbox"
                checked={draft.monthly}
                onChange={(e) =>
                  setDraft({ ...draft, monthly: e.target.checked })
                }
              />
              월간 비중 점검
            </label>
            <select
              aria-label="월간 점검일"
              disabled={!draft.monthly}
              value={draft.day}
              onChange={(e) =>
                setDraft({ ...draft, day: Number(e.target.value) })
              }
            >
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  매월 {i + 1}일
                </option>
              ))}
            </select>
            <small>부족한 포트와 추가 투자금 배분을 확인합니다.</small>
          </div>
          <div className={styles.option}>
            <label>
              <input
                type="checkbox"
                checked={draft.quarterly}
                onChange={(e) =>
                  setDraft({ ...draft, quarterly: e.target.checked })
                }
              />
              분기 말 리밸런싱 점검
            </label>
            <small>
              3·6·9·12월 마지막 날, 범위 밖인 포트가 남아 있는지 확인합니다.
            </small>
          </div>
          <div className={styles.option}>
            <label>
              <input
                type="checkbox"
                checked={draft.threshold}
                onChange={(e) =>
                  setDraft({ ...draft, threshold: e.target.checked })
                }
              />
              허용 범위 이탈 알림
            </label>
            <small>
              앱에서 최근 24시간 안에 확인한 비중을 기준으로, 범위 밖이면 최대
              주 1회 알립니다. 접속하지 않은 동안 시세를 계속 감시하는 기능은
              아닙니다.
            </small>
          </div>
        </fieldset>
        <p className={styles.note}>
          한국 시간 오전 9시 이후 순차 발송합니다. 알림을 켜기 전에는 발송하지
          않으며, 알림 본문에 금액·보유 종목은 표시하지 않습니다.
        </p>
        <div className={styles.actions}>
          <span role="status">
            {dirty
              ? "미저장 변경 있음"
              : saved
                ? "설정 저장됨"
                : "불러오는 중…"}
          </span>
          <button type="submit" disabled={!dirty || busy}>
            {busy ? "저장 중…" : "점검 설정 저장"}
          </button>
        </div>
      </form>
      {saved && (
        <dl className={styles.dates}>
          <div>
            <dt>다음 월간 점검</dt>
            <dd>{saved.monthly ? date(saved.nextMonthly) : "꺼짐"}</dd>
          </div>
          <div>
            <dt>다음 분기 점검</dt>
            <dd>{saved.quarterly ? date(saved.nextQuarterly) : "꺼짐"}</dd>
          </div>
          <div>
            <dt>지난 점검</dt>
            <dd>{date(saved.lastReviewed)}</dd>
          </div>
          {saved.threshold && (
            <div>
              <dt>최근 비중 확인</dt>
              <dd>
                {date(saved.observedAt)}
                {saved.outside === null
                  ? " · 시세 확인 필요"
                  : saved.outside
                    ? " · 범위 밖 포트 있음"
                    : " · 범위 이내"}
              </dd>
            </div>
          )}
        </dl>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function ReviewObservation({
  userId,
  weights,
  ready,
}: {
  userId: string;
  weights: { id: string; percent: number }[];
  ready: boolean;
}) {
  const encoded = JSON.stringify(weights);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener("pf-review-preferences", update);
    return () => window.removeEventListener("pf-review-preferences", update);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void load(userId)
      .then(async (p) => {
        if (!live || !p.threshold) return;
        const response = await fetch("/api/push/review/observe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weights: JSON.parse(encoded) }),
        });
        if (live && response.ok && (await response.json()).observed)
          window.dispatchEvent(new Event("pf-review-observed"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId, ready, encoded, revision]);
  return null;
}
