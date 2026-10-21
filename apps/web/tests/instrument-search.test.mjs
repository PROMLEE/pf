import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/instrument-search.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { searchInstrumentCatalog: search } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const catalog = [
  { symbol: "005930", name: "삼성전자", exchange: "KOSPI" },
  { symbol: "0158S0", name: "엘리스", exchange: "KOSDAQ" },
  { symbol: "015800", name: "테스트 종목", exchange: "KOSDAQ" },
  { symbol: "AAPL", name: "애플", exchange: "NAS" },
];
test("KOSDAQ alphanumeric codes accept exact, lowercase and full-width input", () => {
  for (const query of ["0158S0", "0158s0", "０１５８Ｓ０", "엘리스"])
    assert.deepEqual(search(catalog, query), [catalog[1]]);
});
test("partial codes include KOSDAQ and preserve leading zeroes", () => {
  assert.deepEqual(
    new Set(search(catalog, "0158").map((x) => x.symbol)),
    new Set(["0158S0", "015800"]),
  );
  assert.deepEqual(search(catalog, "0059"), [catalog[0]]);
  assert.deepEqual(search(catalog, "aap"), [catalog[3]]);
  assert.deepEqual(search(catalog, "158S"), []);
});
test("exact names win, partial names work, and misspellings are not silently mapped", () => {
  assert.deepEqual(search(catalog, " 삼성 전자 "), [catalog[0]]);
  assert.deepEqual(search(catalog, "엘리"), [catalog[1]]);
  assert.deepEqual(search(catalog, "앨리스"), []);
  assert.deepEqual(search(catalog, "   "), []);
});
test("code prefix results rank first and results are capped without mutating the catalog", () => {
  const rows = [
    { symbol: "OTHER", name: "AAB 이름" },
    ...Array.from({ length: 15 }, (_, i) => ({
      symbol: `AAB${i}`,
      name: `종목 ${i}`,
    })),
  ];
  const before = JSON.stringify(rows);
  const result = search(rows, "AAB");
  assert.equal(result.length, 12);
  assert.ok(result.every((x) => x.symbol.startsWith("AAB")));
  assert.equal(JSON.stringify(rows), before);
});
