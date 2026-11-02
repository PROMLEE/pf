export type PushEnvironment = {
  supported: boolean;
  secure: boolean;
  permission: NotificationPermission | "unknown";
  ios: boolean;
  android: boolean;
  installed: boolean;
  embedded: boolean;
  inApp: boolean;
  browser: string;
};
export function pushPlatform(
  userAgent: string,
  platform: string,
  touchPoints: number,
) {
  return {
    ios:
      /iPad|iPhone|iPod/.test(userAgent) ||
      (platform === "MacIntel" && touchPoints > 1),
    android: /Android/i.test(userAgent),
    // Whale is a normal browser, not NAVER's in-app WebView.
    inApp:
      /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(/i.test(userAgent) &&
      !/Whale\//i.test(userAgent),
    browser: /Whale\//i.test(userAgent)
      ? "웨일"
      : /SamsungBrowser\//i.test(userAgent)
        ? "삼성 인터넷"
        : /EdgA?\//i.test(userAgent)
          ? "Edge"
          : /Firefox\//i.test(userAgent)
            ? "Firefox"
            : /Chrome\//i.test(userAgent)
              ? "Chrome"
              : "사용 중인 브라우저",
  };
}
export function readPushEnvironment(): PushEnvironment {
  const platform = pushPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  );
  let permission: PushEnvironment["permission"] = "unknown";
  try {
    if ("Notification" in window) permission = Notification.permission;
  } catch {}
  const supported =
    "serviceWorker" in navigator &&
    "Notification" in window &&
    typeof Notification.requestPermission === "function" &&
    ("PushManager" in window ||
      ("ServiceWorkerRegistration" in window &&
        "pushManager" in ServiceWorkerRegistration.prototype));
  return {
    ...platform,
    supported,
    secure: window.isSecureContext,
    permission,
    installed:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    embedded: window.self !== window.top,
  };
}
export function pushAvailability(env: PushEnvironment) {
  if (!env.secure)
    return {
      canRequest: false,
      reason: "HTTPS 주소에서 알림을 설정해 주세요.",
    };
  if (env.embedded)
    return {
      canRequest: false,
      reason: "별도 브라우저 탭에서 사이트를 열어 알림을 설정해 주세요.",
    };
  if (env.ios && !env.installed)
    return {
      canRequest: false,
      reason: "홈 화면에 추가한 뒤 그 아이콘으로 열어 알림을 켤 수 있습니다.",
    };
  if (env.inApp && (!env.supported || env.permission === "denied"))
    return {
      canRequest: false,
      reason:
        "앱 내부 브라우저에서 알림이 제한될 수 있습니다. 외부 브라우저로 열어 주세요.",
    };
  if (!env.supported)
    return {
      canRequest: false,
      reason:
        "이 실행 환경에서 웹 푸시 기능을 사용할 수 없습니다. 일반 브라우저에서 다시 확인해 주세요.",
    };
  if (env.permission === "denied" || env.permission === "unknown")
    return {
      canRequest: false,
      reason:
        "이 환경에서 알림 권한을 사용할 수 없습니다. 사이트·휴대폰 앱 권한 또는 브라우저 제한이 원인일 수 있습니다.",
    };
  return {
    canRequest: true,
    reason:
      env.permission === "granted"
        ? "알림 권한 허용됨 · 기기 연결 가능"
        : "알림을 켜면 권한을 요청합니다.",
  };
}
