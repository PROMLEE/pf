import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/portfolio/route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const validator = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'valid');
const uuid = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === 'uuid'));
const code = ts.transpileModule(`${uuid.getText(ast)}\n${validator.getText(ast)}\nexport {valid};`, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {valid} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const plan = () => ({title:'QA',usdKrw:1400,usdKrwMode:'auto',usdKrwRateDate:null,tolerancePercent:2,
  buckets:[{id:'11111111-1111-4111-8111-111111111111',name:'포트',targetPercent:100,color:'#123456'}],
  rules:[],manualAssets:[],cryptoAssets:[],assignments:[],snapshots:[],cashFlows:[]});
test('tolerance API accepts old clients and both supported modes', () => {
  assert.equal(valid(plan()),true);
  assert.equal(valid({...plan(),toleranceMode:'percentage-points',relativeTolerancePercent:10}),true);
  for(const value of [0,10,100]) assert.equal(valid({...plan(),toleranceMode:'relative',relativeTolerancePercent:value}),true);
});
test('tolerance API rejects invalid modes, out-of-range values and non-numbers', () => {
  for(const value of [null,'money',42,{}]) assert.equal(valid({...plan(),toleranceMode:value}),false);
  for(const value of [null,'10',-1,101,Infinity,NaN]) assert.equal(valid({...plan(),toleranceMode:'relative',relativeTolerancePercent:value}),false);
});
