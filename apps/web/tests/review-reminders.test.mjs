import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = async (p) =>
  ts.transpileModule(await readFile(new URL(p, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const scheduleURL = url(await compile("../app/review-schedule.ts"));
const { nextReview, reviewInput, reviewPayload, emptyReviewPreferences } =
  await import(scheduleURL);
test("monthly and quarter-end dates use Korea 09:00, including leap years and year boundaries", () => {
  assert.equal(
    nextReview("monthly", 1, new Date("2026-10-31T23:59:00Z")),
    "2026-11-01T00:00:00.000Z",
  );
  assert.equal(
    nextReview("monthly", 1, new Date("2026-11-01T00:00:00Z")),
    "2026-12-01T00:00:00.000Z",
  );
  assert.equal(
    nextReview("quarterly", 1, new Date("2026-11-02T00:00:00Z")),
    "2026-12-31T00:00:00.000Z",
  );
  assert.equal(
    nextReview("quarterly", 1, new Date("2026-12-31T00:00:00Z")),
    "2027-03-31T00:00:00.000Z",
  );
  assert.equal(
    nextReview("monthly", 28, new Date("2028-02-27T00:00:00Z")),
    "2028-02-28T00:00:00.000Z",
  );
  assert.equal(
    nextReview("monthly", 1, new Date("2026-11-01T23:59:59.999+09:00")),
    "2026-12-01T00:00:00.000Z",
  );
});
test("review reminders are opt-in and reject invalid schedules; payloads contain no financial values", () => {
  assert.equal(
    emptyReviewPreferences.monthly ||
      emptyReviewPreferences.quarterly ||
      emptyReviewPreferences.threshold,
    false,
  );
  for (const day of [0, 29, 1.5, "1", null])
    assert.equal(
      reviewInput({ monthly: true, quarterly: false, threshold: false, day }),
      null,
    );
  assert.equal(
    reviewInput({
      monthly: "true",
      quarterly: false,
      threshold: false,
      day: 1,
    }),
    null,
  );
  assert.ok(
    reviewInput({ monthly: true, quarterly: true, threshold: false, day: 28 }),
  );
  for (const kind of ["monthly", "quarterly", "threshold"]) {
    const p = reviewPayload(kind, "2026-11-01");
    assert.equal(p.url, "/?view=rebalance");
    assert.doesNotMatch(p.body, /\d|원|USD|BTC/);
  }
});
const state = {
  user: "owner",
  calls: [],
  preferences: { ...emptyReviewPreferences },
  due: [],
  deliveries: [],
  consent: true,
  status: 0,
};
globalThis.__reviewTest = state;
const reset = () =>
  Object.assign(state, {
    user: "owner",
    calls: [],
    due: [],
    deliveries: [],
    consent: true,
    status: 0,
  });
function base(code) {
  return code
    .replace(
      /import \{ NextResponse \} from "next\/server";/,
      "const NextResponse={json:(x,o)=>Response.json(x,o)};",
    )
    .replace(
      /import \{ currentUserId \} from "[^"]+";/,
      "const currentUserId=async()=>globalThis.__reviewTest.user;",
    )
    .replace(
      /import \{ sameOrigin \} from "[^"]+";/,
      'const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;',
    )
    .replace(
      /import \{ getReview, saveReview, completeReview,? \} from "[^"]+";/,
      `const getReview=async u=>{globalThis.__reviewTest.calls.push(['get',u]);return globalThis.__reviewTest.preferences;};const saveReview=async(u,p)=>{globalThis.__reviewTest.calls.push(['save',u,p]);return p;};const completeReview=async u=>{globalThis.__reviewTest.calls.push(['complete',u]);return {};};`,
    )
    .replace(/"[^"\n]*review-schedule"/g, JSON.stringify(scheduleURL));
}
const api = await import(
  url(base(await compile("../app/api/push/review/route.ts")))
);
const request = (body, method = "PATCH", origin = "https://pf.example") =>
  new Request("https://pf.example/api/push/review", {
    method,
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("review API authenticates every operation and scopes save/complete to the session owner", async () => {
  reset();
  state.user = null;
  assert.equal((await api.GET()).status, 401);
  assert.equal((await api.PATCH(request({}))).status, 401);
  assert.equal((await api.POST(request({}, "POST"))).status, 401);
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal(
    (
      await api.PATCH(
        request({
          monthly: true,
          quarterly: false,
          threshold: false,
          day: 1,
          userId: "victim",
        }),
      )
    ).status,
    200,
  );
  assert.equal(state.calls[0][1], "owner");
  const r = await api.GET();
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  await api.POST(request({}, "POST"));
  assert.ok(state.calls.some((c) => c[0] === "complete" && c[1] === "owner"));
});
test("review writes reject foreign origins and invalid inputs before touching storage", async () => {
  reset();
  assert.equal(
    (await api.PATCH(request({}, "PATCH", "https://evil.example"))).status,
    403,
  );
  assert.equal(
    (await api.POST(request({}, "POST", "https://evil.example"))).status,
    403,
  );
  assert.equal((await api.PATCH(request({ day: 99 }))).status, 400);
  assert.equal(state.calls.length, 0);
});
let dispatchCode = (await compile("../lib/review-dispatch.ts"))
  .replace('"../app/review-schedule"', JSON.stringify(scheduleURL))
  .replace(
    /import \{ db \} from "\.\/db";/,
    `const query=async(sql,params)=>{const s=globalThis.__reviewTest;s.calls.push({sql,params});if(sql.startsWith('select r.*'))return{rows:s.due};if(sql.startsWith('with picked'))return{rows:s.deliveries};if(sql.startsWith('select 1 from portfolio.review_preferences'))return{rows:s.consent?[{}]:[]};return{rows:[]};};const db=()=>({query,connect:async()=>({query,release(){}})});`,
  );
const { dispatchReviewReminders } = await import(url(dispatchCode));
const row = {
  user_id: "owner",
  monthly: true,
  day: 1,
  quarterly: false,
  threshold: false,
  next_monthly: new Date("2026-11-01T00:00:00Z"),
  next_quarterly: null,
  last_reviewed: null,
  observed_at: null,
  outside: null,
  last_threshold: null,
  last_band_check: null,
};
test("scheduler enqueues each due calendar period once and advances its next date", async () => {
  reset();
  state.due = [row];
  await dispatchReviewReminders(
    async () => {},
    new Date("2026-11-01T00:01:00Z"),
  );
  const insert = state.calls.find((c) =>
    c.sql?.startsWith("insert into portfolio.review_deliveries"),
  );
  assert.equal(insert.params[0], "owner");
  assert.equal(insert.params[1], "monthly");
  assert.equal(insert.params[2], "2026-11-01");
  assert.match(
    insert.sql,
    /on conflict\(subscription_id,kind,period\) do nothing/,
  );
  assert.ok(
    state.calls.some(
      (c) =>
        c.sql?.includes("set next_monthly=") &&
        c.params[1] === "2026-12-01T00:00:00.000Z",
    ),
  );
});
test("stale observations, weekly cooldown and completed reviews suppress threshold pushes", async () => {
  for (const changes of [
    { observed_at: new Date("2026-10-30") },
    { last_threshold: new Date("2026-11-01T00:00:00Z") },
    { last_reviewed: new Date("2026-11-01T00:01:00Z") },
  ]) {
    reset();
    state.due = [
      {
        ...row,
        monthly: false,
        next_monthly: null,
        threshold: true,
        outside: true,
        observed_at: new Date("2026-11-01T00:00:00Z"),
        ...changes,
      },
    ];
    await dispatchReviewReminders(
      async () => {},
      new Date("2026-11-01T00:02:00Z"),
    );
    assert.ok(
      !state.calls.some((c) =>
        c.sql?.startsWith("insert into portfolio.review_deliveries"),
      ),
    );
  }
  reset();
  state.due = [
    {
      ...row,
      monthly: false,
      next_monthly: null,
      threshold: true,
      outside: true,
      observed_at: new Date("2026-11-01T00:00:00Z"),
    },
  ];
  await dispatchReviewReminders(
    async () => {},
    new Date("2026-11-01T00:02:00Z"),
  );
  assert.ok(state.calls.some((c) => c.params?.[1] === "threshold"));
});
const delivery = {
  id: "delivery",
  user_id: "owner",
  subscription_id: "sub",
  kind: "monthly",
  period: "2026-11-01",
  attempts: 1,
  endpoint: "https://web.push.apple.com/test",
  p256dh: "key",
  auth: "key",
};
test("delivery rechecks consent, retries transient failures and disables expired devices", async () => {
  reset();
  state.deliveries = [delivery];
  state.consent = false;
  let sent = 0;
  await dispatchReviewReminders(async () => {
    sent++;
  });
  assert.equal(sent, 0);
  assert.ok(state.calls.some((c) => c.sql?.includes("state='skipped'")));
  reset();
  state.deliveries = [delivery];
  await dispatchReviewReminders(async () => {
    throw { statusCode: 410 };
  });
  assert.ok(
    state.calls.some(
      (c) => c.sql?.includes("set enabled=false") && c.params[1] === "owner",
    ),
  );
  reset();
  state.deliveries = [delivery];
  await dispatchReviewReminders(async () => {
    throw { statusCode: 503 };
  });
  const retry = state.calls.find((c) => c.sql?.includes("set state=$2"));
  assert.equal(retry.params[1], "pending");
  assert.equal(retry.params[3], 2);
});

const modelURL = url(await compile("../app/portfolio-model.ts"));
const { withinTolerance } = await import(
  url(
    (await compile("../app/rebalance.ts")).replace(
      '"./portfolio-model"',
      JSON.stringify(modelURL),
    ),
  )
);
const observe = await import(
  url(
    base(await compile("../app/api/push/review/observe/route.ts"))
      .replace(
        /import \{ db \} from "[^"]+";/,
        `const db=()=>({query:async(sql,params)=>{const s=globalThis.__reviewTest;s.calls.push({sql,params});return{rows:sql.startsWith('select b.id')?(s.buckets??[]):[]};}});`,
      )
      .replace(
        /import \{ withinTolerance \} from "[^"]+";/,
        `const withinTolerance=${withinTolerance.toString()};`,
      ),
  )
);
test("observations reject unauthenticated, foreign-origin, duplicate and incomplete portfolio weights", async () => {
  reset();
  state.user = null;
  assert.equal((await observe.POST(request({}, "POST"))).status, 401);
  reset();
  assert.equal(
    (await observe.POST(request({}, "POST", "https://evil.example"))).status,
    403,
  );
  for (const weights of [
    [{ id: "a", percent: 101 }],
    [
      { id: "a", percent: 50 },
      { id: "a", percent: 50 },
    ],
    [{ id: "a", percent: 20 }],
  ])
    assert.equal(
      (await observe.POST(request({ weights }, "POST"))).status,
      400,
    );
  assert.equal(state.calls.length, 0);
});
test("observation uses owned server targets and saves only an outside flag, not prices or balances", async () => {
  reset();
  state.buckets = [
    {
      id: "a",
      target_percent: "20",
      tolerance_mode: "relative",
      relative_tolerance_percent: "10",
      tolerance_percent: "2",
    },
    {
      id: "b",
      target_percent: "80",
      tolerance_mode: "relative",
      relative_tolerance_percent: "10",
      tolerance_percent: "2",
    },
  ];
  await observe.POST(
    request(
      {
        weights: [
          { id: "a", percent: 30 },
          { id: "b", percent: 70 },
        ],
        userId: "victim",
      },
      "POST",
    ),
  );
  const write = state.calls.find((c) =>
    c.sql?.startsWith("update portfolio.review_preferences"),
  );
  assert.deepEqual(write.params, ["owner", true]);
  state.calls = [];
  const unknown = await observe.POST(
    request({ weights: [{ id: "other", percent: 100 }] }, "POST"),
  );
  assert.equal((await unknown.json()).observed, false);
  assert.ok(!state.calls.some((c) => c.sql?.startsWith("update")));
});
