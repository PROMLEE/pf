import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createECDH, randomBytes } from "node:crypto";
const compile = async (file) =>
  ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const validation = await import(
  url(await compile("../lib/push-validation.ts"))
);
const dh = createECDH("prime256v1");
dh.generateKeys();
const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: {
    p256dh: dh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
};
test("push subscriptions accept supported HTTPS providers and reject SSRF destinations", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/test",
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://web.push.apple.com/test",
    "https://abc.notify.windows.com/test",
  ])
    assert.ok(validation.pushSubscriptionInput({ ...valid, endpoint }));
  for (const endpoint of [
    "http://fcm.googleapis.com/test",
    "https://localhost/test",
    "https://127.0.0.1/test",
    "https://169.254.169.254/test",
    "https://fcm.googleapis.com.evil.example/test",
    "https://fcm.googleapis.com:444/test",
    "https://name:pass@web.push.apple.com/test",
    "https://example.com/test",
    "https://web.push.apple.com/test#secret",
  ])
    assert.equal(
      validation.pushSubscriptionInput({ ...valid, endpoint }),
      null,
    );
});
test("malformed browser encryption keys and oversized URLs are rejected", () => {
  for (const value of [
    null,
    {},
    { ...valid, endpoint: "x".repeat(2049) },
    { ...valid, keys: { p256dh: "bad", auth: valid.keys.auth } },
    { ...valid, keys: { p256dh: valid.keys.p256dh, auth: "bad" } },
  ])
    assert.equal(validation.pushSubscriptionInput(value), null);
});
const state = {
  user: "owner",
  calls: [],
  rows: [{ id: "sub", endpoint: valid.endpoint, enabled: true, ...valid.keys }],
  sent: [],
};
globalThis.__pfPushTest = state;
function reset() {
  Object.assign(state, {
    user: "owner",
    calls: [],
    rows: [
      { id: "sub", endpoint: valid.endpoint, enabled: true, ...valid.keys },
    ],
    sent: [],
  });
}
function base(code) {
  return code
    .replace(
      /import \{ ?NextResponse ?\} from "next\/server";/,
      "const NextResponse={json:(d,o)=>Response.json(d,o)};",
    )
    .replace(
      /import \{ ?currentUserId ?\} from "[^\"]+";/,
      "const currentUserId=async()=>globalThis.__pfPushTest.user;",
    )
    .replace(
      /import \{ ?sameOrigin ?\} from "[^\"]+";/,
      "const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;",
    )
    .replace(
      /import \{ ?db ?\} from "[^\"]+";/,
      `const query=async(sql,params)=>{const s=globalThis.__pfPushTest;s.calls.push({sql,params});return {rows:s.rows};};const db=()=>({query,connect:async()=>({query,release(){}})});`,
    )
    .replace(
      /import \{ ?pushConfig ?\} from "[^\"]+";/,
      "const pushConfig=async()=>({publicKey:'public',privateKey:'secret',cronSecret:'secret'});",
    )
    .replace(
      /import \{ ?pushSubscriptionInput ?\} from "[^\"]+";/,
      `const pushSubscriptionInput=${validation.pushSubscriptionInput.toString()};`,
    )
    .replace(
      /import \{ ?sendPush ?\} from "[^\"]+";/,
      "const sendPush=async(sub,payload)=>globalThis.__pfPushTest.sent.push({sub,payload});",
    );
}
const route = await import(
  url(base(await compile("../app/api/push/route.ts")))
);
const tester = await import(
  url(base(await compile("../app/api/push/test/route.ts")))
);
const request = (body, method = "POST", origin = "https://pf.example") =>
  new Request("https://pf.example/api/push", {
    method,
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("push settings require login and never return private VAPID or scheduler keys", async () => {
  reset();
  state.user = null;
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.POST(request(valid))).status, 401);
  assert.equal(state.calls.length, 0);
  reset();
  const r = await route.GET();
  const data = await r.json();
  assert.equal(data.publicKey, "public");
  assert.equal(data.privateKey, undefined);
  assert.equal(data.cronSecret, undefined);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(state.calls[0].params, ["owner"]);
});
test("push registration rejects cross-origin and malicious endpoints without DB writes", async () => {
  reset();
  assert.equal(
    (await route.POST(request(valid, "POST", "https://other.example"))).status,
    403,
  );
  assert.equal(
    (await route.POST(request({ ...valid, endpoint: "https://localhost/" })))
      .status,
    400,
  );
  assert.equal(state.calls.length, 0);
});
test("subscription ownership cannot be reassigned and removal scopes to session user", async () => {
  reset();
  state.rows = [];
  assert.equal((await route.POST(request(valid))).status, 409);
  const insert = state.calls.find((c) =>
    c.sql.includes("insert into portfolio.push_subscriptions"),
  );
  assert.match(insert.sql, /user_id=excluded.user_id/);
  assert.equal(insert.params[0], "owner");
  reset();
  assert.equal(
    (await route.DELETE(request({ endpoint: valid.endpoint }, "DELETE")))
      .status,
    200,
  );
  assert.deepEqual(state.calls[0].params, ["owner", valid.endpoint]);
});
test("test push sends only the owner device and rate-limits before sending", async () => {
  reset();
  state.rows = [];
  assert.equal(
    (await tester.POST(request({ endpoint: valid.endpoint }))).status,
    429,
  );
  assert.equal(state.sent.length, 0);
  assert.match(state.calls[0].sql, /last_test_at<now\(\)-interval '1 minute'/);
  reset();
  assert.equal(
    (await tester.POST(request({ endpoint: valid.endpoint }))).status,
    200,
  );
  assert.deepEqual(state.calls[0].params, ["owner", valid.endpoint]);
  assert.equal(state.sent[0].payload.url, "/?view=preferences");
});
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
test("service worker displays plain notifications and restricts click destinations to this app", async () => {
  const handlers = {};
  const shown = [],
    opened = [];
  const context = {
    location: { origin: "https://pf.example" },
    clients: {
      claim() {},
      async matchAll() {
        return [];
      },
      async openWindow(url) {
        opened.push(url);
      },
    },
    registration: {
      async showNotification(title, options) {
        shown.push({ title, options });
      },
    },
    addEventListener(name, fn) {
      handlers[name] = fn;
    },
    skipWaiting() {},
  };
  new Function("self", sw)(context);
  let pending;
  handlers.push({
    data: {
      json: () => ({
        title: "공지",
        body: "test",
        url: "https://evil.example/path",
      }),
    },
    waitUntil(p) {
      pending = p;
    },
  });
  await pending;
  assert.equal(shown[0].options.data.url, "/");
  handlers.notificationclick({
    notification: { close() {}, data: { url: "/?notice=123" } },
    waitUntil(p) {
      pending = p;
    },
  });
  await pending;
  assert.deepEqual(opened, ["https://pf.example/?notice=123"]);
  assert.equal(handlers.fetch, undefined);
});
const queueState = {
  calls: [],
  sendStatus: 0,
  visible: true,
  deliveries: [
    {
      announcement_id: "11111111-1111-4111-8111-111111111111",
      subscription_id: "device",
      attempts: 1,
      endpoint: valid.endpoint,
      ...valid.keys,
    },
  ],
};
globalThis.__pfPushQueueTest = queueState;
let queueCode = await compile("../lib/push.ts");
queueCode = queueCode
  .replace(
    /import webpush from "web-push";/,
    `const webpush={sendNotification:async(sub,payload)=>{const s=globalThis.__pfPushQueueTest;s.calls.push({send:true,sub,payload:JSON.parse(payload)});if(s.sendStatus)throw{statusCode:s.sendStatus};return{statusCode:201};}};`,
  )
  .replace(
    /import \{ db \} from "[^\"]+";/,
    `const query=async(sql,params)=>{const s=globalThis.__pfPushQueueTest;s.calls.push({sql,params});if(sql.includes('vault.decrypted_secrets'))return{rows:[{name:'portrhythm_push_public',decrypted_secret:'public'},{name:'portrhythm_push_private',decrypted_secret:'private'},{name:'portrhythm_push_cron',decrypted_secret:'secret'}]};if(sql.startsWith('with picked'))return{rows:s.deliveries};if(sql.startsWith('select a.title'))return{rows:s.visible?[{title:'공개 공지'}]:[]};return{rows:[]};};const db=()=>({query,connect:async()=>({query,release(){}})});`,
  )
  .replace(
    /import \{ pushSubscriptionInput \} from "[^\"]+";/,
    `const pushSubscriptionInput=${validation.pushSubscriptionInput.toString()};`,
  );
const queue = await import(url(queueCode));
function queueReset(status = 0, visible = true) {
  Object.assign(queueState, { calls: [], sendStatus: status, visible });
}
test("scheduler authentication is exact and requires a configured secret", () => {
  assert.equal(queue.cronAuthorized("Bearer secret", "secret"), true);
  for (const header of [null, "", "secret", "Bearer wrong", "bearer secret"])
    assert.equal(queue.cronAuthorized(header, "secret"), false);
  assert.equal(queue.cronAuthorized("Bearer ", " "), false);
});
test("dispatch sends only still-visible announcements and marks completion", async () => {
  queueReset();
  await queue.dispatchPush();
  const send = queueState.calls.find((c) => c.send);
  assert.equal(
    send.payload.url,
    "/?notice=11111111-1111-4111-8111-111111111111",
  );
  assert.equal(send.payload.body, "공개 공지");
  assert.ok(queueState.calls.some((c) => c.sql?.includes("state='sent'")));
  queueReset(0, false);
  await queue.dispatchPush();
  assert.ok(!queueState.calls.some((c) => c.send));
  assert.ok(queueState.calls.some((c) => c.sql?.includes("state='skipped'")));
});
test("expired push endpoint is disabled while transient failure is retried with backoff", async () => {
  queueReset(410);
  await queue.dispatchPush();
  assert.ok(queueState.calls.some((c) => c.sql?.includes("set enabled=false")));
  assert.equal(
    queueState.calls.find((c) => c.sql?.includes("next_attempt_at=now()+"))
      .params[2],
    "skipped",
  );
  queueReset(500);
  await queue.dispatchPush();
  const retry = queueState.calls.find((c) =>
    c.sql?.includes("next_attempt_at=now()+"),
  );
  assert.equal(retry.params[2], "pending");
  assert.equal(retry.params[4], 2);
});
const noticeLink = await import(url(await compile("../lib/notice-link.ts")));
test("notification login return preserves only a valid notice and never a client redirect", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    noticeLink.noticeReturnPath("https://pf.example/?notice=" + id),
    "/?notice=" + id,
  );
  for (const source of [
    "bad",
    "https://pf.example/?callbackUrl=https://evil.example",
    "https://pf.example/?notice=https://evil.example",
    "https://pf.example/?notice=123",
  ])
    assert.equal(noticeLink.noticeReturnPath(source), "/");
});
