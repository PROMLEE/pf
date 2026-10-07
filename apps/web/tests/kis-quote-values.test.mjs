import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/kis-quote-values.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { domesticPreviousClose } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("the actual domestic current-price response yields a previous close", () => {
  assert.equal(
    domesticPreviousClose({
      stck_prpr: "269000",
      prdy_vrss: "-3000",
      prdy_vrss_sign: "5",
    }),
    272000,
  );
});

test("KIS rise, fall and unchanged codes determine the change direction", () => {
  for (const sign of ["1", "2"]) {
    assert.equal(
      domesticPreviousClose({
        stck_prpr: "1100",
        prdy_vrss: "100",
        prdy_vrss_sign: sign,
      }),
      1000,
    );
  }
  for (const sign of ["4", "5"]) {
    assert.equal(
      domesticPreviousClose({
        stck_prpr: "900",
        prdy_vrss: "100",
        prdy_vrss_sign: sign,
      }),
      1000,
    );
  }
  assert.equal(
    domesticPreviousClose({
      stck_prpr: "1000",
      prdy_vrss: "0",
      prdy_vrss_sign: "3",
    }),
    1000,
  );
});

test("missing or malformed change data is not treated as zero", () => {
  for (const change of [undefined, null, "", " ", "invalid"]) {
    assert.equal(
      domesticPreviousClose({ stck_prpr: "1000", prdy_vrss: change }),
      null,
    );
  }
  assert.equal(
    domesticPreviousClose({ stck_prpr: "invalid", prdy_vrss: "0" }),
    null,
  );
  assert.equal(
    domesticPreviousClose({
      stck_prpr: "100",
      prdy_vrss: "200",
      prdy_vrss_sign: "2",
    }),
    null,
  );
});
