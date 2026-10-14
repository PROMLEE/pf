"use client";
import { useEffect, useState } from "react";
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
  const [supported, setSupported] = useState(false),
    [permission, setPermission] = useState<NotificationPermission>("default"),
    [ready, setReady] = useState(false),
    [key, setKey] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false),
    [endpoint, setEndpoint] = useState(""),
    [message, setMessage] = useState(""),
    [ios, setIos] = useState(false),
    [installed, setInstalled] = useState(false),
    [install, setInstall] = useState<BeforeInstall | null>(null);
  useEffect(() => {
    let live = true;
    const support =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      window.isSecureContext;
    setSupported(support);
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    if (support) setPermission(Notification.permission);
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
      setInstalled(true);
      setInstall(null);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", added);
    return () => {
      live = false;
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", added);
    };
  }, []);
  async function toggle() {
    setBusy(true);
    setMessage("");
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
        setMessage("이 기기의 공지 알림을 껐습니다.");
        return;
      }
      // Must execute directly in the button gesture; never prompt on page load.
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted")
        throw new Error("브라우저에서 알림을 허용해야 받을 수 있습니다.");
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
      setMessage("이 기기의 공지 알림을 켰습니다.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "알림 설정을 변경하지 못했습니다.",
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
  const needInstall = ios && !installed;
  return (
    <section className={styles.settings} aria-labelledby="push-settings-title">
      <h2 id="push-settings-title">알림·앱 설치</h2>
      <p>새 공지를 브라우저 알림으로 받으세요. 이 기기에만 적용됩니다.</p>
      <div className={styles.row}>
        <div>
          <strong>공지 알림</strong>
          <small>
            {loading
              ? "설정 확인 중…"
              : !ready
                ? "서버 알림 설정 준비 중"
                : needInstall
                  ? "홈 화면에 추가 후 알림을 켤 수 있습니다."
                  : !supported
                    ? "이 브라우저에서는 푸시 알림을 지원하지 않습니다."
                    : permission === "denied"
                      ? "브라우저 설정에서 알림 차단을 해제해 주세요."
                      : enabled
                        ? "이 기기에서 수신 중"
                        : "꺼짐"}
          </small>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={
            loading ||
            busy ||
            !ready ||
            !supported ||
            needInstall ||
            (!enabled && permission === "denied")
          }
          aria-pressed={enabled}
        >
          {busy ? "처리 중" : enabled ? "알림 끄기" : "알림 켜기"}
        </button>
      </div>
      {enabled && (
        <button type="button" disabled={busy} onClick={() => void test()}>
          테스트 알림 보내기
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {!installed && (
        <div className={styles.install}>
          <strong>홈 화면에서 앱처럼 사용하기</strong>
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
        </div>
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
