import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/client-session.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { requestSession, sessionAfterResult } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const now = Date.parse("2026-10-08T12:00:00Z");
const session = {
  user: { name: "QA", appUserId: "qa" },
  expires: "2026-10-09T12:00:00Z",
};
const response =
  (body, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

test("a mobile resume network failure preserves an unexpired verified session", async () => {
  const result = await requestSession(async () => {
    throw new TypeError("Network connection lost");
  });
  assert.equal(result.kind, "unavailable");
  assert.equal(sessionAfterResult(session, result, now), session);
});
test("server errors and a proxy HTML response do not confirm logout", async () => {
  for (const fetcher of [
    response({}, 503),
    async () => new Response("<html>offline</html>"),
  ]) {
    const result = await requestSession(fetcher);
    assert.equal(result.kind, "unavailable");
    assert.equal(sessionAfterResult(session, result, now), session);
  }
});
test("a failed initial check remains pending rather than showing logged-out UI", async () => {
  const result = await requestSession(async () => {
    throw new Error("offline");
  });
  assert.equal(sessionAfterResult(undefined, result, now), undefined);
});
test("real empty session and 401 responses clear an old login", async () => {
  for (const fetcher of [response({}), response(null), response({}, 401)]) {
    const result = await requestSession(fetcher);
    assert.equal(result.kind, "confirmed");
    assert.equal(sessionAfterResult(session, result, now), null);
  }
});
test("expired sessions are never kept during an outage", () => {
  assert.equal(
    sessionAfterResult(
      session,
      { kind: "unavailable" },
      Date.parse(session.expires),
    ),
    null,
  );
});
test("a successful retry restores login after an initially failed check", async () => {
  const result = await requestSession(response(session));
  assert.deepEqual(sessionAfterResult(undefined, result, now), session);
});
test("a renewed session updates expiry and the account identity", async () => {
  const renewed = {
    ...session,
    user: { name: "Other", appUserId: "other" },
    expires: "2026-10-10T12:00:00Z",
  };
  assert.deepEqual(
    sessionAfterResult(session, await requestSession(response(renewed)), now),
    renewed,
  );
});
test("malformed session data cannot become an authenticated context", async () => {
  for (const value of [
    [],
    "unexpected",
    { user: {}, expires: "invalid" },
    { expires: session.expires },
  ]) {
    assert.equal((await requestSession(response(value))).kind, "unavailable");
  }
});
test("verification uses same-origin cookies and avoids HTTP caches", async () => {
  await requestSession(async (url, options) => {
    assert.equal(url, "/api/auth/session");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(session));
  });
});

test("a stalled mobile connection times out without clearing a valid session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = requestSession(
    async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  t.mock.timers.tick(12_000);
  const result = await pending;
  assert.equal(result.kind, "unavailable");
  assert.equal(sessionAfterResult(session, result, now), session);
});
