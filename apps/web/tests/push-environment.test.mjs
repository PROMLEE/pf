import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = ts.transpileModule(
  await readFile(
    new URL("../app/push-environment.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  pushPlatform,
  pushAvailability,
  readPushEnvironment,
  canAttemptPushPermission,
  requestPushPermission,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const android = {
  supported: true,
  secure: true,
  permission: "default",
  ios: false,
  android: true,
  installed: false,
  embedded: false,
  inApp: false,
  browser: "웨일",
};
test("Android Whale is a normal browser and does not require the iOS home-screen flow", () => {
  const platform = pushPlatform(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Whale/3.11 Mobile Safari/537.36",
    "Linux armv8l",
    5,
  );
  assert.equal(platform.android, true);
  assert.equal(platform.ios, false);
  assert.equal(platform.inApp, false);
  assert.equal(platform.browser, "웨일");
  assert.equal(pushAvailability(android).canRequest, true);
});
test("denied permission never claims that the user manually blocked notifications and can recover after permission changes", () => {
  const denied = pushAvailability({ ...android, permission: "denied" });
  assert.equal(denied.canRequest, false);
  assert.doesNotMatch(denied.reason, /차단을 해제/);
  assert.match(denied.reason, /휴대폰 앱 권한/);
  assert.equal(
    pushAvailability({ ...android, permission: "granted" }).canRequest,
    true,
  );
  assert.equal(
    pushAvailability({ ...android, permission: "default" }).canRequest,
    true,
  );
});
test("installation, iframe and in-app requirements take priority over permission denial", () => {
  assert.match(
    pushAvailability({
      ...android,
      ios: true,
      android: false,
      permission: "denied",
    }).reason,
    /홈 화면/,
  );
  assert.match(
    pushAvailability({ ...android, embedded: true, permission: "denied" })
      .reason,
    /별도 브라우저 탭/,
  );
  assert.match(
    pushAvailability({ ...android, inApp: true, permission: "denied" }).reason,
    /외부 브라우저/,
  );
  assert.equal(
    pushAvailability({
      ...android,
      ios: true,
      installed: true,
      permission: "granted",
    }).canRequest,
    true,
  );
});
test("insecure, unsupported and unreadable permission contexts cannot request permission", () => {
  assert.equal(
    pushAvailability({ ...android, secure: false }).canRequest,
    false,
  );
  assert.equal(
    pushAvailability({ ...android, supported: false }).canRequest,
    false,
  );
  assert.equal(
    pushAvailability({ ...android, permission: "unknown" }).canRequest,
    false,
  );
});
test("environment reinspection reads the current permission rather than a cached value", () => {
  const names = [
    "window",
    "navigator",
    "Notification",
    "ServiceWorkerRegistration",
  ];
  const old = new Map(
    names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  try {
    const notification = {
      permission: "denied",
      requestPermission: async () => "granted",
    };
    const win = {
      Notification: notification,
      isSecureContext: true,
      ServiceWorkerRegistration: class {},
      matchMedia: () => ({ matches: false }),
    };
    win.self = win;
    win.top = win;
    win.ServiceWorkerRegistration.prototype.pushManager = {};
    for (const [name, value] of Object.entries({
      window: win,
      navigator: {
        userAgent: "Android Whale/3.11",
        platform: "Linux",
        maxTouchPoints: 5,
        serviceWorker: {},
      },
      Notification: notification,
      ServiceWorkerRegistration: win.ServiceWorkerRegistration,
    }))
      Object.defineProperty(globalThis, name, { value, configurable: true });
    assert.equal(readPushEnvironment().supported, true);
    assert.equal(readPushEnvironment().permission, "denied");
    notification.permission = "granted";
    assert.equal(readPushEnvironment().permission, "granted");
    assert.equal(pushAvailability(readPushEnvironment()).canRequest, true);
  } finally {
    for (const name of names) {
      const descriptor = old.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("a direct denied-permission retry invokes the browser API synchronously without fabricating a grant", async () => {
  const denied = { ...android, permission: "denied" };
  let requests = 0;
  assert.equal(canAttemptPushPermission(denied), true);
  const pending = requestPushPermission(denied, () => {
    requests++;
    return Promise.resolve("denied");
  });
  assert.equal(requests, 1);
  assert.equal(await pending, "denied");
  assert.equal(
    requestPushPermission({ ...denied, supported: false }, () => {
      requests++;
      return Promise.resolve("granted");
    }),
    null,
  );
  assert.equal(requests, 1);
  assert.equal(
    await requestPushPermission({ ...denied, permission: "granted" }, () => {
      requests++;
      return Promise.resolve("granted");
    }),
    "granted",
  );
  assert.equal(requests, 1);
});
