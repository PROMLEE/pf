import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const originalFetch = globalThis.fetch;
const prior = {
  id: process.env.TOSS_CLIENT_ID,
  secret: process.env.TOSS_CLIENT_SECRET,
};
const state = { row: null, issued: 0, queries: [], blocked: false };
globalThis.__pfTossAuth = state;
const source = ts.transpileModule(
  await readFile(new URL("../lib/toss-auth.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const code = source.replace(
  /import \{ db \} from "\.\/db";/,
  `const db=()=>({connect:async()=>({query:async(sql,args)=>{const s=globalThis.__pfTossAuth;s.queries.push(sql);if(sql.startsWith('select token_ciphertext'))return {rows:s.row?[s.row]:[]};if(sql.startsWith('insert into'))s.row={token_ciphertext:args[1],expires_at:args[2]};return {rows:[]};},release(){}})});`,
);
let generation = 0;
const load = () =>
  import(
    `data:text/javascript;base64,${Buffer.from(code + `\n// instance ${generation++}`).toString("base64")}`
  );
const setup = () => {
  process.env.TOSS_CLIENT_ID = "fake-client";
  process.env.TOSS_CLIENT_SECRET = "fake-secret";
  state.row = null;
  state.issued = 0;
  state.queries = [];
  state.blocked = false;
  globalThis.fetch = async (input, options) => {
    assert.equal(input, "https://openapi.tossinvest.com/oauth2/token");
    assert.equal(
      options.headers["content-type"],
      "application/x-www-form-urlencoded",
    );
    assert.equal(options.body.get("grant_type"), "client_credentials");
    if (state.blocked)
      return Response.json(
        { error_description: "fake-secret" },
        { status: 403 },
      );
    state.issued++;
    return Response.json({
      access_token: `fake-token-${state.issued}`,
      expires_in: 86400,
    });
  };
};
test("simultaneous callers issue one token and a cold instance reuses encrypted persisted token", async () => {
  setup();
  const api = await load();
  const tokens = await Promise.all(
    Array.from({ length: 10 }, () => api.tossToken()),
  );
  assert.ok(tokens.every((x) => x === "fake-token-1"));
  assert.equal(state.issued, 1);
  assert.ok(!state.row.token_ciphertext.includes("fake-token"));
  assert.ok(!state.row.token_ciphertext.includes("fake-secret"));
  assert.ok(state.queries.some((x) => x.includes("pg_advisory_xact_lock")));
  const cold = await load();
  assert.equal(await cold.tossToken(), "fake-token-1");
  assert.equal(state.issued, 1);
});
test("a rejected token is replaced once and other cold instances use the new token", async () => {
  setup();
  const api = await load();
  await api.tossToken();
  assert.equal(await api.tossToken("fake-token-1"), "fake-token-2");
  const cold = await load();
  assert.equal(await cold.tossToken("fake-token-1"), "fake-token-2");
  assert.equal(state.issued, 2);
});
test("expired or unreadable persisted tokens are replaced without exposing upstream errors", async () => {
  setup();
  let api = await load();
  await api.tossToken();
  state.row.expires_at = new Date(0);
  api = await load();
  assert.equal(await api.tossToken(), "fake-token-2");
  state.row.token_ciphertext = "not-ciphertext";
  api = await load();
  assert.equal(await api.tossToken(), "fake-token-3");
  setup();
  state.blocked = true;
  api = await load();
  await assert.rejects(
    api.tossToken(),
    (error) =>
      error.message.includes("허용 IP") &&
      !error.message.includes("fake-secret"),
  );
  assert.ok(state.queries.includes("rollback"));
  assert.equal(state.row, null);
});
test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [
    ["TOSS_CLIENT_ID", prior.id],
    ["TOSS_CLIENT_SECRET", prior.secret],
  ])
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});
