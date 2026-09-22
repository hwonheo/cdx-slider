import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Companion} from '../src/companion.mjs';

function fixture(t) {
 const home=mkdtempSync(join(tmpdir(),'slider-bar-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const threads=[{id:'a',name:'Same title',cwd:'/project'},{id:'b',name:'Same title',cwd:'/project'},{id:'c',name:'Load checkpoint',cwd:'/project'}];
 const store={home,profiles:()=>[{id:'desktop',label:'Desktop'}],projects:()=>[{id:'p',name:'Project',path:'/project'}],project:(p,u)=>{if(p!=='p'||u!=='desktop')throw Error('Denied');return {path:'/project'};},resume:()=>({checkpoint:{id:'old'}})};
 const calls=[];
 const rpc={request:async(method,args)=>{
  calls.push({method,args});
  if(method==='thread/list')return {data:threads,nextCursor:null};
  if(method==='thread/read')return {thread:threads.find(t=>t.id===args.threadId)};
  throw Error('Unexpected writer operation: '+method);
 }};
 return {c:new Companion(store,rpc),rpc,store,threads,calls};
}
const context={profile:'desktop',project:'p',language:'ko'};
test('duplicate titles retain every ID; binding persists the selected ID',async t=>{
 const {c,store,rpc}=fixture(t);
 assert.deepEqual((await c.handle({action:'threads',...context})).threads.map(t=>t.id),['a','b','c']);
 await c.handle({action:'bind',...context,threadId:'c'});
 assert.deepEqual(new Companion(store,rpc).state().bindings['desktop/p'],{id:'c',title:'Load checkpoint'});
 await c.handle({action:'bind',...context,threadId:'b'});
 assert.equal(c.state().bindings['desktop/p'].id,'b');
});
test('project access and thread identity are validated before changing binding',async t=>{
 const {c,threads,rpc}=fixture(t);
 await c.handle({action:'bind',...context,threadId:'a'});
 threads[1].cwd='/other';await assert.rejects(c.handle({action:'bind',...context,threadId:'b'}),/폴더/);
 await assert.rejects(c.handle({action:'bind',...context,profile:'other',threadId:'a'}),/Denied/);
 rpc.request=async()=>({thread:threads[0]});
 await assert.rejects(c.handle({action:'bind',...context,threadId:'c'}),/ID/);
 assert.equal(c.state().bindings['desktop/p'].id,'a');
});
test('Desktop-owned active threads prepare all requests without acquiring any writer',async t=>{
 const {c,calls,threads}=fixture(t);
 threads[0].status={type:'active'};
 await c.handle({action:'bind',...context,threadId:'a'});
 for(const [action,tool] of [['save','checkpoint_save'],['resume','project_resume']]){
  const r=await c.handle({action,...context});
  assert.equal(r.threadId,'a');assert.equal(r.delivery,'clipboard');assert.match(r.prompt,new RegExp(tool));
  assert.match(r.message,/아직 요청은 실행되지/);assert.equal(r.checkpointId,undefined);
 }
 assert.ok(calls.every(c=>c.method==='thread/read'));
});
test('missing binding and checkpoint report errors without starting a turn',async t=>{
 const {c,store}=fixture(t);
 await assert.rejects(c.handle({action:'resume',...context}),/먼저/);
 await c.handle({action:'bind',...context,threadId:'a'});store.resume=()=>({});
 await assert.rejects(c.handle({action:'resume',...context}),/체크포인트/);
 assert.equal(c.busy,false);
});
test('a pending bind blocks competing selection and binding updates',async t=>{
 const {c,rpc,threads}=fixture(t);let finish;
 rpc.request=()=>new Promise(resolve=>{finish=()=>resolve({thread:threads[0]})});
 const pending=c.handle({action:'bind',...context,threadId:'a'});
 await assert.rejects(c.handle({action:'bind',...context,threadId:'b'}),/진행 중/);
 await assert.rejects(c.handle({action:'select',...context}),/진행 중/);
 finish();await pending;assert.equal(c.state().bindings['desktop/p'].id,'a');
});

test('companion defaults to English and localizes prompts per request', async t => {
 const {c,calls}=fixture(t);
 const target={profile:'desktop',project:'p'};
 await assert.rejects(c.handle({action:'resume',...target}), /Connect a conversation/);
 await c.handle({action:'bind',...target,threadId:'a'});
 const english=await c.handle({action:'save',...target});
 const korean=await c.handle({action:'save',...target,language:'ko'});
 assert.match(english.prompt,/Exclude secrets/);
 assert.match(english.message,/has not run yet/);
 assert.match(korean.prompt,/비밀 정보는 제외/);
 assert.match(korean.message,/아직 요청은 실행되지/);
 assert.ok(calls.every(call=>call.method==='thread/read'));
});


test('panel opens directly without a conversation binding or a model request', async t => {
 const {c,calls}=fixture(t);
 const result=await c.handle({action:'panel',...context});
 assert.equal(result.delivery,'deeplink');
 const url=new URL(result.url);
 assert.equal(url.host,'mcp-app');
 assert.equal(decodeURIComponent(url.pathname),'/cdx-slider@personal/slider_home');
 assert.equal(url.searchParams.get('profile'),'desktop');
 assert.equal(url.searchParams.get('project'),'p');
 assert.equal(result.prompt,undefined);
 assert.equal(calls.length,0);
 assert.equal(new URL((await c.handle({action:'panel'})).url).search,'');
 await assert.rejects(c.handle({action:'panel',profile:'other',project:'p'}),/Denied/);
});
