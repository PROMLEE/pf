import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const input = await import(url(await compile("../lib/announcements.ts")));
const state = { role: true, auth: 200, calls: [], missing: false };
globalThis.__pfAdminTest = state;
let accessCode = await compile("../lib/admin.ts");
accessCode = accessCode
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(d,o)=>Response.json(d,o)};",
  )
  .replace(
    /import \{ currentUserId \} from "[^\"]+";/,
    "const currentUserId=async()=>null;",
  )
  .replace(
    /import \{ db \} from "[^\"]+";/,
    "const db=()=>({query:async()=>({rows:[{is_admin:false}]})});",
  );
const access = await import(url(accessCode));
let code = await compile("../app/api/admin/announcements/route.ts");
code = code
  .replace(/import \{ after \} from "next\/server";/, "const after=()=>{};")
  .replace(
    /import \{ dispatchPush, pushConfig \} from "[^\"]+";/,
    "const dispatchPush=async()=>{};const pushConfig=async()=>({publicKey:'test'});",
  )
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(d,o)=>Response.json(d,o)};",
  )
  .replace(
    /import \{ adminAccess, sameOrigin \} from "[^\"]+";/,
    `const adminAccess=async()=>({userId:'owner',response:globalThis.__pfAdminTest.auth===200?null:Response.json({}, {status:globalThis.__pfAdminTest.auth})});const sameOrigin=${access.sameOrigin.toString()};`,
  )
  .replace(
    /import \{ announcementInput \} from "[^\"]+";/,
    `const announcementInput=(${input.announcementInput.toString()});`,
  )
  .replace(
    /import \{ db \} from "[^\"]+";/,
    `const db=()=>({connect:async()=>({release(){},async query(sql,params){const s=globalThis.__pfAdminTest;s.calls.push({sql,params});if(sql.startsWith('select is_admin'))return{rows:[{is_admin:s.role}]};if(sql.includes('returning *'))return{rows:s.missing?[]:[{id:'11111111-1111-4111-8111-111111111111',revision:1}]};return{rows:[]};}})});`,
  );
const route = await import(url(code));
const valid = {
  title: "공지",
  body: "내용",
  status: "draft",
  important: false,
  startsAt: null,
  endsAt: null,
};
const request = (body, origin = "https://pf.example") =>
  new Request("https://pf.example/api/admin/announcements", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function reset() {
  Object.assign(state, { role: true, auth: 200, calls: [], missing: false });
}
test("announcement validation rejects invalid input and reversed dates", () => {
  for (const body of [
    null,
    {},
    { ...valid, title: " " },
    { ...valid, body: "x".repeat(10001) },
    { ...valid, status: "unknown" },
    { ...valid, important: "true" },
    { ...valid, startsAt: "bad" },
    { ...valid, startsAt: "2026-10-20", endsAt: "2026-10-19" },
  ])
    assert.equal(input.announcementInput(body), null);
  assert.equal(
    input.announcementInput({ ...valid, title: " 공지 " }).title,
    "공지",
  );
});
test("signed-out and ordinary users cannot write admin data", async () => {
  for (const status of [401, 403]) {
    reset();
    state.auth = status;
    assert.equal((await route.POST(request(valid))).status, status);
    assert.equal(state.calls.length, 0);
  }
});
test("cross-origin writes are denied before database access", async () => {
  reset();
  assert.equal(
    (await route.POST(request(valid, "https://evil.example"))).status,
    403,
  );
  assert.equal(state.calls.length, 0);
});
test("invalid payload and editing ID cannot start a transaction", async () => {
  reset();
  assert.equal((await route.POST(request(null))).status, 400);
  assert.equal(
    (await route.PATCH(request({ ...valid, id: "other", revision: 1 }))).status,
    400,
  );
  assert.equal(state.calls.length, 0);
});
test("admin revocation between access check and save rolls back", async () => {
  reset();
  state.role = false;
  assert.equal((await route.POST(request(valid))).status, 403);
  assert.ok(state.calls.some((c) => c.sql === "rollback"));
  assert.ok(
    !state.calls.some((c) =>
      c.sql.includes("insert into portfolio.announcements"),
    ),
  );
});
test("notice and audit event commit together with session actor", async () => {
  reset();
  assert.equal(
    (await route.POST(request({ ...valid, actorId: "attacker" }))).status,
    201,
  );
  const audit = state.calls.find((c) =>
    c.sql.includes("insert into portfolio.admin_events"),
  );
  assert.equal(audit.params[0], "owner");
  assert.equal(state.calls.at(-1).sql, "commit");
});
test("stale revision cannot overwrite or create audit", async () => {
  reset();
  state.missing = true;
  assert.equal(
    (
      await route.PATCH(
        request({
          ...valid,
          id: "11111111-1111-4111-8111-111111111111",
          revision: 1,
        }),
      )
    ).status,
    409,
  );
  assert.ok(state.calls.some((c) => c.sql === "rollback"));
  assert.ok(
    !state.calls.some((c) =>
      c.sql.includes("insert into portfolio.admin_events"),
    ),
  );
});
test("production never trusts local QA environment as an admin role", async () => {
  const env = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    process.env.LOCAL_ADMIN_USER_ID = "qa";
    process.env.LOCAL_ADMIN_USERNAME = "qa";
    process.env.LOCAL_ADMIN_PASSWORD = "test";
    assert.equal(await access.isAdmin("qa"), false);
    assert.equal(await access.isAdmin(null), false);
  } finally {
    for (const k of [
      "NODE_ENV",
      "LOCAL_ADMIN_USER_ID",
      "LOCAL_ADMIN_USERNAME",
      "LOCAL_ADMIN_PASSWORD",
    ]) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  }
});

test("origin check accepts trusted host behind Next proxy and rejects other hosts or missing origin", () => {
  assert.equal(
    access.sameOrigin(
      new Request("http://localhost:3011/api/admin", {
        headers: { host: "127.0.0.1:3011", origin: "http://127.0.0.1:3011" },
      }),
    ),
    true,
  );
  assert.equal(
    access.sameOrigin(
      new Request("https://pf.example/api/admin", {
        headers: { origin: "https://evil.example" },
      }),
    ),
    false,
  );
  assert.equal(
    access.sameOrigin(new Request("https://pf.example/api/admin")),
    false,
  );
});
let readCode = await compile("../app/api/admin/route.ts");
readCode = readCode
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(d,o)=>Response.json(d,o)};",
  )
  .replace(
    /import \{ adminAccess \} from "[^\"]+";/,
    `const adminAccess=async()=>({userId:'owner',response:globalThis.__pfAdminTest.auth===200?null:Response.json({}, {status:globalThis.__pfAdminTest.auth})});`,
  )
  .replace(
    /import \{ db \} from "[^\"]+";/,
    `const db=()=>({query:async(sql,params)=>{globalThis.__pfAdminTest.calls.push({sql,params});return{rows:[{total:0}]};}});`,
  );
const readRoute = await import(url(readCode));
test("admin reads deny signed-out and ordinary sessions before reading users", async () => {
  for (const status of [401, 403]) {
    reset();
    state.auth = status;
    assert.equal(
      (await readRoute.GET(new Request("https://pf.example/api/admin"))).status,
      status,
    );
    assert.equal(state.calls.length, 0);
  }
});
test("user search escapes LIKE wildcards and uses parameterized service member scope", async () => {
  reset();
  const r = await readRoute.GET(
    new Request("https://pf.example/api/admin?search=%25_&page=2"),
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  const users = state.calls.find((c) => c.sql.includes("u.nickname,"));
  assert.ok(users.sql.includes("portfolio.members"));
  assert.deepEqual(users.params, ["%\\%\\_%", 30]);
});

test("only published announcements can queue a push, with queue and audit in the save transaction", async () => {
  reset();
  assert.equal(
    (await route.POST(request({ ...valid, sendPush: true }))).status,
    400,
  );
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal(
    (
      await route.POST(
        request({ ...valid, status: "published", sendPush: true }),
      )
    ).status,
    201,
  );
  const queue = state.calls.find((c) =>
    c.sql.includes("insert into portfolio.push_campaigns"),
  );
  assert.ok(queue);
  assert.ok(queue.sql.includes("on conflict do nothing"));
  assert.equal(state.calls.at(-1).sql, "commit");
});
