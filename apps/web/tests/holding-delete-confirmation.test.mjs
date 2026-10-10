import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;
function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='removeHolding')handler=node.getText(ast);ts.forEachChild(node,find);}find(ast);
assert.ok(handler);
const code=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const row={id:'qa',name:'애플',symbol:'AAPL',quantity:10};
function setup(pending,{deleting=null,saving=false,fail=false}={}){
 const requests=[];const notices=[];const updates=[];const cleared=[];
 const remove=new Function('holdings','deletingHoldingId','holdingSaving','pendingHoldingRemoval','setDeletingHoldingId','data','fetch','setHoldings','editingHoldingId','setEditingHoldingId','setPendingHoldingRemoval','setNotice',code+';return removeHolding;')([row],deleting,saving,pending,()=>{},async res=>res,async(url,options)=>{requests.push({url,options});if(fail)throw new Error('network unavailable');return {holdings:[]};},rows=>updates.push(rows),row.id,()=>{},value=>cleared.push(value),value=>notices.push(value));
 return {remove,requests,notices,updates,cleared};
}
test('clicking X or canceling never authorizes a holding deletion',async()=>{
 for(const pending of [null,'another-row']){const s=setup(pending);await s.remove(row.id);assert.equal(s.requests.length,0);assert.equal(s.updates.length,0);}
});
test('confirming the exact holding deletes it and updates the displayed rows',async()=>{
 const s=setup(row.id);await s.remove(row.id);assert.equal(s.requests.length,1);assert.equal(s.requests[0].url,'/api/holdings');assert.equal(s.requests[0].options.method,'DELETE');assert.deepEqual(JSON.parse(s.requests[0].options.body),{id:row.id});assert.deepEqual(s.updates,[[]]);assert.deepEqual(s.cleared,[null]);assert.match(s.notices[0],/애플/);
});
test('busy updates and failed deletions do not remove displayed holdings',async()=>{
 for(const option of [{deleting:row.id},{saving:true}]){const s=setup(row.id,option);await s.remove(row.id);assert.equal(s.requests.length,0);}
 const failed=setup(row.id,{fail:true});await failed.remove(row.id);assert.equal(failed.updates.length,0);assert.equal(failed.cleared.length,0);assert.match(failed.notices[0],/network unavailable/);
});
