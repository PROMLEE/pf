import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const {profileImageUrl}=new Function('exports',compile(await readFile(new URL('../lib/profile-image.ts',import.meta.url),'utf8'))+';return exports;')({});
const source=(await readFile(new URL('../lib/auth.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function callbacks(query){const provider=o=>o;return new Function('exports','db','Kakao','Naver','Credentials','timingSafeEqual','profileImageUrl',compile(source)+';return exports.authOptions.callbacks;')({},()=>({query}),provider,provider,provider,()=>false,profileImageUrl);}
test('photo URLs reject unsafe schemes and upgrade HTTP CDN links',()=>{
 assert.equal(profileImageUrl('http://phinf.pstatic.net/photo.jpg'),'https://phinf.pstatic.net/photo.jpg');
 for(const value of [null,'','javascript:alert(1)','data:image/png;base64,abc','https://user:password@example.com/a','invalid'])assert.equal(profileImageUrl(value),null);
});
test('existing OAuth account refreshes its photo while keeping identity and nickname',async()=>{
 const calls=[];const cb=callbacks(async(sql,args)=>{calls.push({sql,args});return {rows:[{userId:'existing',nickname:'Saved name',profileImageUrl:null}]};});
 const token=await cb.jwt({token:{},account:{provider:'naver',providerAccountId:'id'},user:{name:'Provider name',image:'https://phinf.pstatic.net/new.jpg'}});
 assert.equal(token.appUserId,'existing');assert.equal(token.name,'Saved name');assert.equal(token.picture,'https://phinf.pstatic.net/new.jpg');
 assert.equal(calls.length,2);assert.match(calls[1].sql,/update public\."User"/);assert.deepEqual(calls[1].args,[token.picture,'existing','NAVER','id']);
 const session=await cb.session({session:{user:{}},token});assert.equal(session.user.image,token.picture);
});
test('missing photo consent preserves an existing saved photo',async()=>{
 let queries=0;const cb=callbacks(async()=>{queries++;return {rows:[{userId:'existing',nickname:'Name',profileImageUrl:'https://cdn.example.com/saved.jpg'}]};});
 const token=await cb.jwt({token:{},account:{provider:'kakao',providerAccountId:'id'},user:{image:null}});
 assert.equal(token.picture,'https://cdn.example.com/saved.jpg');assert.equal(queries,1);
});
test('existing session loads its saved photo once without repeated DB queries',async()=>{
 let queries=0;const cb=callbacks(async()=>{queries++;return {rows:[{oauthProvider:'NAVER',profileImageUrl:'https://phinf.pstatic.net/saved.jpg'}]};});
 let token=await cb.jwt({token:{appUserId:'existing'}});assert.equal(token.loginProvider,'naver');assert.equal(token.picture,'https://phinf.pstatic.net/saved.jpg');
 token=await cb.jwt({token});assert.equal(queries,1);assert.equal(token.appUserId,'existing');
});
test('photo persistence failure does not prevent a valid login',async()=>{
 let queries=0;const cb=callbacks(async()=>{queries++;if(queries===2)throw new Error('write failure');return {rows:[{userId:'existing',nickname:'Name',profileImageUrl:null}]};});
 const token=await cb.jwt({token:{},account:{provider:'naver',providerAccountId:'id'},user:{image:'https://phinf.pstatic.net/new.jpg'}});
 assert.equal(token.appUserId,'existing');assert.equal(token.picture,'https://phinf.pstatic.net/new.jpg');
});
