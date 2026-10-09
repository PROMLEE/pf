import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = ts.transpileModule(await readFile(new URL('../app/accounts-model.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const { accountValuation, purchaseTotal } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const row = (data={}) => ({market:'KR',quantity:2,currentPrice:1000,capturedPrice:null,quoteCheckedAt:'2026-10-10T01:00:00Z',...data});
test('account totals never mix won and dollar values',()=>{
 const result=accountValuation([row(),row({market:'US',currentPrice:100})]);
 assert.equal(result.KR.value,2000); assert.equal(result.US.value,200);
});
test('unavailable prices are excluded and have no priced count',()=>{
 const result=accountValuation([row({currentPrice:null})]);
 assert.equal(result.unpriced,1);assert.equal(result.KR.priced,0);
});
test('capture fallback and oldest verified quote are disclosed',()=>{
 const result=accountValuation([row(),row({quoteCheckedAt:'2026-10-09T01:00:00Z'}),row({currentPrice:null,capturedPrice:900})]);
 assert.equal(result.captured,1);assert.equal(result.KR.value,5800);assert.equal(result.oldestCheckedAt,'2026-10-09T01:00:00Z');
});
test('purchase check requires both valid positive numbers',()=>{
 assert.equal(purchaseTotal('2','95000'),190000);assert.equal(purchaseTotal('0.5','180.50'),90.25);
 for(const [quantity,cost] of [['','10'],['2',''],['bad','10'],['-1','10'],['1','Infinity']]) assert.equal(purchaseTotal(quantity,cost),null);
});
