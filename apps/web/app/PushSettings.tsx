"use client";
import { useEffect, useState } from "react";
import {
  readPushEnvironment,
  pushAvailability,
  canAttemptPushPermission,
  requestPushPermission,
  type PushEnvironment,
} from "./push-environment";
import styles from "./PushSettings.module.css";
type BeforeInstall = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
function keyBytes(key: string) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
export default function PushSettings() {
  const [environment, setEnvironment] = useState<PushEnvironment | null>(null),
    [ready, setReady] = useState(false),
    [key, setKey] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false),
    [endpoint, setEndpoint] = useState(""),
    [message, setMessage] = useState(""),
    [install, setInstall] = useState<BeforeInstall | null>(null);
  const [checked, setChecked] = useState<{ at: number; count: number } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    const initial = readPushEnvironment();
    setEnvironment(initial);
    const support = initial.supported && initial.secure;
    const refreshEnvironment = () => {
      if (document.visibilityState !== "visible") return;
      const next = readPushEnvironment();
      setEnvironment(next);
      if (next.permission !== "granted") setEnabled(false);
    };
    window.addEventListener("focus", refreshEnvironment);
    document.addEventListener("visibilitychange", refreshEnvironment);
    void (async () => {
      try {
        const r = await fetch("/api/push", { cache: "no-store" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.message);
        if (!live) return;
        setReady(data.ready);
        setKey(data.publicKey ?? "");
        const registration = support
          ? await navigator.serviceWorker.getRegistration("/")
          : undefined;
        const sub = await registration?.pushManager.getSubscription();
        if (!live) return;
        setEndpoint(sub?.endpoint ?? "");
        setEnabled(
          !!sub &&
            data.subscriptions.some(
              (s: { endpoint: string; enabled: boolean }) =>
                s.endpoint === sub.endpoint && s.enabled,
            ),
        );
      } catch (e) {
        if (live)
          setMessage(
            e instanceof Error ? e.message : "알림 설정을 불러오지 못했습니다.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    const prompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as BeforeInstall);
    };
    const added = () => {
      setEnvironment(readPushEnvironment());
      setInstall(null);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", added);
    return () => {
      live = false;
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", added);
      window.removeEventListener("focus", refreshEnvironment);
      document.removeEventListener("visibilitychange", refreshEnvironment);
    };
  }, []);
  function recheck() {
    setChecked((previous) => ({
      at: Date.now(),
      count: (previous?.count ?? 0) + 1,
    }));
    const next = readPushEnvironment();
    setEnvironment(next);
    if (next.permission !== "granted") setEnabled(false);
    setMessage(
      pushAvailability(next).canRequest
        ? "권한 상태를 다시 확인했습니다. 알림 켜기를 눌러 연결해 주세요."
        : pushAvailability(next).reason,
    );
  }
  async function toggle() {
    const context = readPushEnvironment();
    setEnvironment(context);
    if (!enabled && !canAttemptPushPermission(context)) {
      recheck();
      return;
    }
    setBusy(true);
    setMessage(
      enabled
        ? "알림을 끄고 있습니다."
        : context.permission === "granted"
          ? "알림 기기를 연결하고 있습니다."
          : `${context.browser}에 알림 권한을 요청하고 있습니다.`,
    );
    try {
      if (enabled) {
        const r = await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.message);
        setEnabled(false);
        setMessage("이 기기의 브라우저 알림을 껐습니다.");
        return;
      }
      // Must execute directly in the button gesture; never prompt on page load.
      const request = requestPushPermission(context, () =>
        Notification.requestPermission(),
      );
      if (!request) {
        recheck();
        return;
      }
      const allowed = await request;
      const next = readPushEnvironment();
      setEnvironment(next);
      if (allowed !== "granted")
        throw new Error(
          allowed === "default"
            ? "알림 요청이 아직 허용되지 않았습니다. 요청 창을 닫았다면 알림 켜기를 다시 눌러 주세요."
            : `${context.browser}이 권한 요청을 허용하지 않아 알림을 연결하지 못했습니다. 권한 창이 나타나지 않았다면 브라우저가 요청을 즉시 거절한 상태이며, 사이트에서 이를 강제로 해제할 수는 없습니다.`,
        );
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (sub && sub.options.applicationServerKey) {
        const old = new Uint8Array(sub.options.applicationServerKey);
        const next = keyBytes(key);
        if (old.length !== next.length || old.some((v, i) => v !== next[i])) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) await sub.unsubscribe();
        throw new Error(data.message);
      }
      setEndpoint(sub.endpoint);
      setEnabled(true);
      setMessage("이 기기의 브라우저 알림을 켰습니다.");
    } catch (e) {
      const next = readPushEnvironment();
      setEnvironment(next);
      setMessage(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "알림 연결이 허용되지 않았습니다. 사이트 권한과 휴대폰의 브라우저 앱 알림 권한을 함께 확인한 뒤 상태 다시 확인을 눌러 주세요."
          : e instanceof Error
            ? e.message
            : "알림 설정을 변경하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      const data = await r.json();
      setMessage(data.message);
    } catch {
      setMessage("테스트 알림을 발송하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const availability = environment
    ? pushAvailability(environment)
    : { canRequest: false, reason: "실행 환경 확인 중…" };
  const ios = environment?.ios ?? false;
  const installed = environment?.installed ?? false;
  const restricted = !!environment && !availability.canRequest;
  const permission = environment?.permission ?? "unknown";
  return (
    <section className={styles.settings} aria-labelledby="push-settings-title">
      <h2 id="push-settings-title">브라우저 알림</h2>
      <p>공지와 포트폴리오 점검 알림을 이 기기에서 받습니다.</p>
      <div className={styles.row}>
        <div>
          <strong>이 기기의 알림</strong>
          <small>
            {loading
              ? "설정 확인 중…"
              : !ready
                ? "서버 알림 설정 준비 중"
                : enabled && permission === "granted"
                  ? "이 기기에서 수신 중"
                  : availability.reason}
          </small>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={loading || busy || !ready || !environment}
          aria-pressed={enabled}
        >
          {busy
            ? "처리 중"
            : enabled
              ? "알림 끄기"
              : environment?.permission === "denied" &&
                  canAttemptPushPermission(environment)
                ? "알림 권한 요청"
                : restricted
                  ? "상태 다시 확인"
                  : "알림 켜기"}
        </button>
      </div>
      {message && (
        <p className={styles.feedback} role="status" aria-live="polite">
          {message}
        </p>
      )}
      {environment && restricted && (
        <details className={styles.install}>
          <summary>알림이 연결되지 않나요?</summary>
          {environment.android ? (
            <p>
              휴대폰 설정 → 애플리케이션 → {environment.browser} → 알림과,
              브라우저의 이 사이트 알림 권한을 각각 확인해 주세요. 메뉴 이름은
              기기에 따라 다를 수 있습니다. 허용 상태인데도 계속 불가능하면 일반
              모드에서 다시 열거나 다른 브라우저로 비교해 주세요.
            </p>
          ) : ios && installed ? (
            <p>
              휴대폰 설정 → 알림에서 홈 화면에 추가한 PortRhythm의 알림 권한을
              확인해 주세요.
            </p>
          ) : !ios ? (
            <p>
              사이트 권한과 운영체제의 브라우저 앱 알림 권한을 함께 확인해
              주세요.
            </p>
          ) : null}
          <p>
            권한 값만으로 사용자가 직접 차단했는지 판별할 수 없습니다. 설정에서
            돌아오면 상태를 다시 확인합니다.
          </p>
          <p>
            AdGuard 같은 광고 차단 앱을 사용한다면 ‘Push API 차단’도 확인해
            주세요. 브라우저에서 허용해도 웹 알림이 차단될 수 있습니다.
          </p>
        </details>
      )}
      <details className={styles.diagnostics}>
        <summary>알림 상태 확인</summary>
        <dl>
          <div>
            <dt>브라우저</dt>
            <dd>{environment?.browser ?? "확인 중"}</dd>
          </div>
          <div>
            <dt>실행 방식</dt>
            <dd>{installed ? "홈 화면 앱" : "브라우저 탭"}</dd>
          </div>
          <div>
            <dt>웹 푸시 기능</dt>
            <dd>{environment?.supported ? "감지됨" : "사용 불가"}</dd>
          </div>
          <div>
            <dt>알림 권한</dt>
            <dd>
              {permission === "granted"
                ? "허용"
                : permission === "default"
                  ? "아직 결정되지 않음"
                  : permission === "denied"
                    ? "사용 불가 (denied)"
                    : "확인 불가"}
            </dd>
          </div>
          <div>
            <dt>기기 연결</dt>
            <dd>{enabled ? "연결됨" : "연결 안 됨"}</dd>
          </div>
        </dl>
        <button type="button" disabled={busy || loading} onClick={recheck}>
          상태 다시 확인
        </button>
        {checked && (
          <p role="status">
            상태 확인 {checked.count}회 ·{" "}
            {new Date(checked.at).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}{" "}
            ·{" "}
            {permission === "denied"
              ? "여전히 권한 사용 불가"
              : permission === "granted"
                ? "권한 허용됨"
                : "확인 완료"}
          </p>
        )}
      </details>
      {enabled && (
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => void test()}
        >
          테스트 알림 보내기
        </button>
      )}
      {!installed && (
        <details className={styles.install}>
          <summary>홈 화면에 앱 추가</summary>
          {install ? (
            <button
              type="button"
              onClick={async () => {
                await install.prompt();
                await install.userChoice;
                setInstall(null);
              }}
            >
              홈 화면에 설치
            </button>
          ) : (
            <p>
              {ios
                ? "아이폰에서는 Safari의 공유 메뉴 → 홈 화면에 추가를 선택하세요. iOS 16.4 이상에서 설치한 앱으로 열어야 푸시 알림을 받을 수 있습니다."
                : "브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 이용하세요. 설치 메뉴가 없는 브라우저에서도 사이트를 그대로 사용할 수 있습니다."}
            </p>
          )}
        </details>
      )}
    </section>
  );
}

export async function detachPushOnLogout() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await fetch("/api/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe();
  }
}
