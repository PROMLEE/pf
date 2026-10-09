import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const state = { user: 'owner', calls: [], exists: true };
globalThis.__pfFlowTest = state;
let source = ts.transpileModule(await readFile(new URL('../app/api/portfolio/cash-flows/route.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
source = source.replace(/import \{ NextResponse \} from "next\/server";/, 'const NextResponse = {json:(data,options)=>Response.json(data,options)};')
.replace(/import \{ currentUserId \} from "[^\"]+";/,'const currentUserId = async()=>globalThis.__pfFlowTest.user;')
.replace(/import \{[^}]+\} from "[^\"]+portfolio-db";/, `const listPortfolio=async()=>globalThis.__pfFlowTest.exists ? {cashFlows:[]} : null;
const addCashFlow=async(user,flow)=>{globalThis.__pfFlowTest.calls.push({kind:'add',user,flow});return {cashFlows:[flow]};};
const updateCashFlow=async(user,flow)=>{globalThis.__pfFlowTest.calls.push({kind:'update',user,flow});return flow.id === '11111111-1111-4111-8111-111111111111' ? {cashFlows:[flow]} : null;};
const deleteCashFlow=async()=>true;`);
const api=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const id='11111111-1111-4111-8111-111111111111';
const request=(method,body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/portfolio/cash-flows',{method,headers:{host:'localhost:3000',origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const body={id,date:'2026-10-09',amountKrw:1000,note:'QA'};
const reset=()=>{state.user='owner';state.calls=[];state.exists=true;};
test('edit updates the selected id for the authenticated owner',async()=>{reset();const r=await api.PUT(request('PUT',body));assert.equal(r.status,200);assert.equal(state.calls[0].kind,'update');assert.equal(state.calls[0].user,'owner');assert.equal(state.calls[0].flow.id,id);});
test('unknown or other-owner entry reports not found',async()=>{reset();assert.equal((await api.PUT(request('PUT',{...body,id:'22222222-2222-4222-8222-222222222222'}))).status,404);});
test('edit requires a valid UUID',async()=>{reset();assert.equal((await api.PUT(request('PUT',{...body,id:'bad'}))).status,400);assert.equal(state.calls.length,0);});
test('invalid calendar date is rejected',async()=>{reset();assert.equal((await api.PUT(request('PUT',{...body,date:'2026-02-30'}))).status,400);});
test('unauthenticated mutations are rejected',async()=>{reset();state.user=null;assert.equal((await api.PUT(request('PUT',body))).status,401);assert.equal(state.calls.length,0);});
test('cross-origin mutation is rejected',async()=>{reset();assert.equal((await api.PUT(request('PUT',body,'https://other.example'))).status,403);assert.equal(state.calls.length,0);});
test('restoration creates one new entry with the original amount and note',async()=>{reset();const r=await api.POST(request('POST',{...body,amountKrw:-2000}));assert.equal(r.status,200);assert.equal(state.calls[0].kind,'add');assert.equal(state.calls[0].flow.amountKrw,-2000);assert.notEqual(state.calls[0].flow.id,id);});
test('zero and nonfinite amount cannot be saved',async()=>{reset();assert.equal((await api.PUT(request('PUT',{...body,amountKrw:0}))).status,400);assert.equal((await api.PUT(request('PUT',{...body,amountKrw:null}))).status,400);});
