import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/history-performance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {historyPerformance:p,kstTime,kstDay,dailyObservations,dailyPositionChanges}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const snapshot=(at,value)=>({date:kstDay(at),recordedAt:at,valueKrw:value});
const flow=(at,value)=>({id:at,date:kstDay(at),occurredAt:at,amountKrw:value,note:''});
const start='2026-10-09T01:00:00Z',end='2026-10-09T03:00:00Z';
const points=[snapshot(start,1000),snapshot(end,1600)];
test('same-day flows between observations are subtracted',()=>{const r=p(points,[flow('2026-10-09T02:00:00Z',500)]);assert.equal(r.change,600);assert.equal(r.netFlow,500);assert.equal(r.adjusted,100);});
test('flow before the first observation is excluded even on the same day',()=>assert.equal(p(points,[flow('2026-10-09T00:30:00Z',500)]).adjusted,600));
test('flow after the last observation is excluded even on the same day',()=>assert.equal(p(points,[flow('2026-10-09T04:00:00Z',500)]).adjusted,600));
test('start is exclusive and end is inclusive',()=>assert.equal(p(points,[flow(start,100),flow(end,200)]).netFlow,200));
test('withdrawal increases flow-adjusted change',()=>assert.equal(p(points,[flow('2026-10-09T02:00:00Z',-500)]).adjusted,1100));
test('unknown boundary time blocks the adjusted figure',()=>{const r=p(points,[{id:'old',date:'2026-10-09',amountKrw:500,note:''}]);assert.equal(r.adjusted,null);assert.equal(r.ambiguous.length,1);assert.equal(r.change,600);});
test('unknown occurrence on an interior day is definitely within the period',()=>{const r=p([snapshot('2026-10-07T01:00:00Z',1000),snapshot('2026-10-09T03:00:00Z',1600)],[{date:'2026-10-08',amountKrw:500}]);assert.equal(r.adjusted,100);});
test('legacy snapshot boundaries are handled conservatively',()=>{const r=p([{date:'2026-10-08',valueKrw:1000},snapshot(end,1600)],[flow('2026-10-08T01:00:00Z',500)]);assert.equal(r.adjusted,null);});
test('unsorted observations use timestamp order',()=>assert.equal(p([...points].reverse(),[]).change,600));
test('one observation does not claim a performance period',()=>assert.equal(p([points[0]],[]).change,null));
test('equivalent timezone offsets compare by instant',()=>assert.equal(p(points,[flow('2026-10-09T11:00:00+09:00',500)]).adjusted,100));
test('Korean day and midnight display are correct',()=>{assert.equal(kstDay('2026-10-08T15:00:00Z'),'2026-10-09');assert.equal(kstTime('2026-10-08T15:00:00Z',true),'00:00:00');});

test('observation offsets sort chronologically, not lexically',()=>assert.equal(p([snapshot('2026-10-09T10:00:00+09:00',1000),snapshot('2026-10-09T03:00:00Z',1600)],[]).change,600));

test('deleted flows are excluded even if passed in a combined list',()=>assert.equal(p(points,[{...flow('2026-10-09T02:00:00Z',500),deletedAt:'2026-10-09T04:00:00Z'}]).adjusted,600));

test('daily summaries keep the last observed checkpoint for each day',()=>{const result=dailyObservations([...points,snapshot('2026-10-08T01:00:00Z',800)]);assert.equal(result.length,2);assert.equal(result[1].valueKrw,1600);});

test('input-change dates include intraday changes even when final positions return to the baseline',()=>{
 const rows=[{...snapshot(start,1000),positionSignature:'A'},{...snapshot('2026-10-09T02:00:00Z',1200),positionSignature:'B'},{...snapshot(end,1000),positionSignature:'A'}];
 assert.deepEqual([...dailyPositionChanges(rows)],['2026-10-09']);
});
test('a missing baseline is never claimed as a confirmed position change',()=>{
 const rows=[{...snapshot(start,1000),positionSignature:null},{...snapshot(end,1000),positionSignature:'A'}];
 assert.equal(dailyPositionChanges(rows).size,0);
});
