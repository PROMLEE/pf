import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../app/unsaved-changes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {protectUnsavedChanges}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('unmodified data never installs a navigation blocker',()=>{
 const calls=[];const target={addEventListener(...args){calls.push(args);},removeEventListener(...args){calls.push(args);}};
 protectUnsavedChanges(target,false)();assert.equal(calls.length,0);
});
test('modified data requests the native unload confirmation and removes it after cleanup',()=>{
 let handler;const removed=[];const target={addEventListener(name,fn){assert.equal(name,'beforeunload');handler=fn;},removeEventListener(name,fn){removed.push([name,fn]);}};
 const cleanup=protectUnsavedChanges(target,true);let prevented=false;
 const event={preventDefault(){prevented=true;},returnValue:undefined};handler(event);
 assert.equal(prevented,true);assert.equal(event.returnValue,'');cleanup();assert.deepEqual(removed,[['beforeunload',handler]]);
});
