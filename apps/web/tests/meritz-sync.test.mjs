import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const compile=async f=>ts.transpileModule(await readFile(new URL(f,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const state={user:'owner',allowed:true,calls:[]};globalThis.__syncApi=state;
let code=await compile('../app/api/accounts/meritz/sync/route.ts');
code=code.replace(/import \{ NextResponse \} from "next\/server";/,'const NextResponse={json:(d,o)=>Response.json(d,o)};').replace(/import \{ currentUserId \} from "[^\"]+";/,'const currentUserId=async()=>globalThis.__syncApi.user;').replace(/import \{ sameOrigin \} from "[^\"]+";/,'const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;').replace(/import \{ meritzAvailable \} from "[^\"]+";/,'const meritzAvailable=()=>globalThis.__syncApi.allowed;').replace(/import \{[^}]+\} from "[^\"]+meritz-sync";/,'const call=(...args)=>{globalThis.__syncApi.calls.push(args);return {enabled:true}};const meritzSyncStatus=call,configureMeritzSync=call,setMeritzSyncEnabled=call,syncMeritzBalance=call,disconnectMeritzSync=call;').replace(/import \{ MeritzImportError \} from "[^\"]+";/,'class MeritzImportError extends Error{}');
const api=await import(url(code));const req=(method,body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/accounts/meritz/sync',{method,headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('automatic Meritz sync is restricted to session owner and same-origin POST/PATCH',async()=>{state.user=null;assert.equal((await api.POST(req('POST'))).status,401);state.user='owner';state.allowed=false;assert.equal((await api.POST(req('POST'))).status,403);state.allowed=true;assert.equal((await api.PATCH(req('PATCH',{enabled:true},'https://evil.test'))).status,403);assert.equal(state.calls.length,0);});
test('sync cannot use browser-supplied owner/account and malformed settings cannot change binding',async()=>{assert.equal((await api.POST(req('POST',{user:'intruder',accountId:'foreign'}))).status,200);assert.deepEqual(state.calls.at(-1),['owner']);for(const body of [{enabled:'true'},{action:'configure',accountId:'x',krwAssetId:'y',usdAssetId:'z'}])assert.equal((await api.PATCH(req('PATCH',body))).status,400);assert.equal((await api.PATCH(req('PATCH',{enabled:false}))).status,200);assert.deepEqual(state.calls.at(-1),['owner',false]);assert.equal((await api.PATCH(req('PATCH',{action:'disconnect'}))).status,200);assert.deepEqual(state.calls.at(-1),['owner']);});
test('foreign viewers only receive unavailable status, never sync data',async()=>{state.allowed=false;const r=await api.GET();assert.deepEqual(await r.json(),{available:false});assert.match(r.headers.get('cache-control'),/no-store/);state.allowed=true;});
// Exercise the one-shot sync effect with browser events and controlled asynchronous responses.
const h={refs:[],states:[],effects:[],refIndex:0,stateIndex:0};globalThis.__syncHook=h;
const react=url('export const useRef=v=>{const h=globalThis.__syncHook;return h.refs[h.refIndex++]??(h.refs[h.refIndex-1]={current:v});};export const useState=v=>{const h=globalThis.__syncHook,i=h.stateIndex++;h.states[i]??=v;return [h.states[i],v=>{h.states[i]=typeof v==="function"?v(h.states[i]):v;}];};export const useEffect=f=>{globalThis.__syncHook.effects.push(f);};');
code=(await compile('../app/use-meritz-sync.ts')).replace(/from "react";/,`from ${JSON.stringify(react)};`);
const hook=await import(url(code));
test('one initial sync, no polling or focus repeat, manual requests are deduplicated and protected',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldDocument=globalThis.document;
 const listeners=new Map(),docListeners=new Map();let posts=0,applied=0,resolvePost;
 globalThis.window={setInterval:()=>{throw Error('polling is forbidden');},addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),dispatchEvent(){}};
 globalThis.document={visibilityState:'visible',addEventListener:(k,f)=>docListeners.set(k,f),removeEventListener:k=>docListeners.delete(k)};
 globalThis.fetch=async(_,options)=>{if(options?.method==='POST'){posts++;return new Promise(resolve=>{resolvePost=()=>resolve(Response.json({sync:{available:true,enabled:true},holdings:[],portfolio:{}}));});}return Response.json({available:true,enabled:true});};
 const flush=()=>new Promise(r=>setImmediate(r));
 try{
 hook.useMeritzSync({userId:'owner',authenticated:true,paused:true,onApplied:()=>applied++});const cleanup=h.effects[0]();await flush();assert.equal(posts,0);
 h.refs[0].current.paused=false;h.refs[1].current();await flush();assert.equal(posts,1);resolvePost();await flush();assert.equal(applied,1);
 assert.equal(listeners.has('focus'),false);document.visibilityState='hidden';docListeners.get('visibilitychange')();document.visibilityState='visible';docListeners.get('visibilitychange')();h.refs[1].current();await flush();assert.equal(posts,1);
 listeners.get(hook.meritzSyncRequestEvent)();listeners.get(hook.meritzSyncRequestEvent)();await flush();assert.equal(posts,2);resolvePost();await flush();assert.equal(applied,2);
 h.refs[0].current.paused=true;listeners.get(hook.meritzSyncRequestEvent)();await flush();assert.equal(posts,2);h.refs[0].current.paused=false;h.refs[1].current();await flush();assert.equal(posts,2);
 listeners.get(hook.meritzSyncRequestEvent)();await flush();assert.equal(posts,3);cleanup();resolvePost();await flush();assert.equal(applied,2);assert.equal(listeners.size,0);assert.equal(docListeners.size,0);
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
