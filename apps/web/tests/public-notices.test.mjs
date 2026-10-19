import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const state = { calls: [], rows: [] };
globalThis.__pfPublicNoticesTest = state;
const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const code = (await compile("../lib/public-notices.ts"))
  .replace(/import \{ cache \} from "react";/, "const cache = fn => fn;")
  .replace(/import \{ db \} from "\.\/db";/, "const db=()=>({query:async(sql,params)=>{const s=globalThis.__pfPublicNoticesTest;s.calls.push({sql,params});return {rows:s.rows};}});");
const notices = await import(moduleUrl(code));
const id = "11111111-1111-4111-8111-111111111111";
const visibleOnly = sql => {
  assert.match(sql, /status='published'/);
  assert.match(sql, /starts_at is null or starts_at<=now\(\)/);
  assert.match(sql, /ends_at is null or ends_at>now\(\)/);
};
test("public list excludes drafts, future and ended notices at query time without exposing admin fields", async () => {
  state.calls=[]; state.rows=[];
  await notices.listPublicNotices();
  const {sql}=state.calls[0]; visibleOnly(sql);
  assert.match(sql, /^select id,title,important,created_at,updated_at from/);
  assert.doesNotMatch(sql, /select \*|created_by|revision|push_requested/);
});
test("public detail uses the same visibility rules and a bound UUID", async () => {
  state.calls=[]; state.rows=[{id,title:"Public",body:"Text"}];
  assert.equal((await notices.getPublicNotice(id)).title,"Public");
  visibleOnly(state.calls[0].sql);
  assert.match(state.calls[0].sql,/and id=\$1/);
  assert.deepEqual(state.calls[0].params,[id]);
  state.rows=[];assert.equal(await notices.getPublicNotice(id),null);
});
test("invalid and injection-shaped notice IDs never query the database", async () => {
  state.calls=[];
  for(const value of ["", "missing", "' OR 1=1 --", `${id}/extra`]) assert.equal(await notices.getPublicNotice(value),null);
  assert.equal(state.calls.length,0);
});
test("sitemap uses the public projection, canonical detail paths and real modification dates", async () => {
  const record={id,updated_at:new Date("2026-10-19T00:00:00Z")};
  globalThis.__pfSitemapTest=[record];
  const sitemapCode=(await compile("../app/sitemap.ts")).replace(/import \{ listPublicNotices \} from "[^\"]+";/,"const listPublicNotices=async()=>globalThis.__pfSitemapTest;");
  const sitemap=await import(moduleUrl(sitemapCode));
  assert.equal(sitemap.dynamic,"force-dynamic");
  const entries=await sitemap.default();
  assert.ok(entries.some(entry=>entry.url==="https://pf.promleeblog.com/notices"));
  assert.deepEqual(entries.find(entry=>entry.url.endsWith(`/${id}`)),{url:`https://pf.promleeblog.com/notices/${id}`,lastModified:record.updated_at});
  assert.ok(entries.every(entry=>!entry.url.includes("?")));
});
