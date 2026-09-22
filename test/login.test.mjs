import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LoginController } from '../src/login.mjs';
function fixture(t, mode) {
 const dir = mkdtempSync(join(tmpdir(), 'slider-login-'));
 const file = join(dir,'codex'), log = join(dir,'calls');
 writeFileSync(file, `#!${process.execPath}\nconst fs=require('node:fs');
 const mode=${JSON.stringify(mode)},log=${JSON.stringify(log)};
 const reply=m=>process.stdout.write(JSON.stringify(m)+'\\n');
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);fs.appendFileSync(log,m.method+'\\n');
  if(m.method==='initialize') return reply({id:1,result:{}});
  if(m.method==='account/login/start') {
   if(mode==='timeout')return;
   const done={method:'account/login/completed',params:{loginId:'login-1',success:true}};
   if(mode==='early')reply(done);
   reply({id:2,result:{type:'chatgpt',loginId:'login-1',authUrl:mode==='evil'?'https://evil.example/oauth':'https://auth.openai.com/oauth/authorize?state=test'}});
   if(mode==='success')setTimeout(()=>reply(done),40);
   if(mode==='wrong-id')reply({...done,params:{loginId:'another-login',success:true}});
  }
  if(m.method==='account/login/cancel'){if(mode==='cancel-race')reply({method:'account/login/completed',params:{loginId:'login-1',success:true}});reply({id:3,result:{}});}
 });`, {mode:0o700});
 const controller = new LoginController({command:file,startupMs:3000,timeoutMs:10000});
 t.after(()=>{controller.close();rmSync(dir,{recursive:true,force:true})});
 return {controller,log};
}
async function waitStatus(c,status) {
 for(let i=0;i<100;i++){if(c.status().status===status)return;await delay(10)}
 assert.equal(c.status().status,status);
}
test('OAuth completion, concurrent start reuse, and no credential or logout calls', async t=>{
 const {controller:c,log}=fixture(t,'success');
 const [a,b]=await Promise.all([c.start(),c.start()]);
 assert.equal(a.sessionId,b.sessionId);assert.equal(a.status,'pending');
 await waitStatus(c,'completed');assert.equal(c.status().authUrl,undefined);
 assert.equal(c.status().desktopAccountVerified,false);
 assert.deepEqual(readFileSync(log,'utf8').trim().split('\n'),['initialize','initialized','account/login/start']);
});
test('cancel matches session and ignores unrelated completion notifications',async t=>{
 const {controller:c,log}=fixture(t,'wrong-id'); const a=await c.start();
 assert.throws(()=>c.cancel('different'));
 assert.equal(c.cancel(a.sessionId).status,'cancelling');
 assert.equal((await c.start()).sessionId,a.sessionId);
 await waitStatus(c,'cancelled');assert.match(readFileSync(log,'utf8'),/account\/login\/cancel/);
 assert.equal(c.status().authUrl,undefined);
});
test('early completion, untrusted OAuth URL, timeout and expiration',async t=>{
 const early=fixture(t,'early').controller;await early.start();assert.equal(early.status().status,'completed');
 const evil=fixture(t,'evil').controller;assert.equal((await evil.start()).status,'failed');
 const timeout=fixture(t,'timeout').controller;timeout.startupMs=100;assert.equal((await timeout.start()).status,'failed');
 const expired=fixture(t,'pending').controller;await expired.start();clearTimeout(expired.timer);expired.timer=setTimeout(()=>expired.finish('expired'),30);await waitStatus(expired,'expired');
 assert.equal(expired.status().authUrl,undefined);
});


test('automatic restart only follows opted-in successful OAuth, never opening or cancelling login', async t => {
  let schedules=0;
  const restart={status:()=>({supported:true}),schedule:confirmed=>{assert.equal(confirmed,true);schedules++}};
  const c=fixture(t,'success').controller;c.restart=restart;
  await assert.rejects(c.start({autoRestart:true,workSaved:false}));
  assert.equal(schedules,0);
  await c.start({autoRestart:true,workSaved:true});await waitStatus(c,'completed');assert.equal(schedules,1);
  const cancelled=fixture(t,'pending').controller;cancelled.restart=restart;
  const pending=await cancelled.start({autoRestart:true,workSaved:true});cancelled.cancel(pending.sessionId);
  await waitStatus(cancelled,'cancelled');assert.equal(schedules,1);
  const plain=fixture(t,'success').controller;plain.restart=restart;
  await plain.start();await waitStatus(plain,'completed');assert.equal(schedules,1);
});


test('cancellation racing with OAuth completion suppresses automatic restart',async t=>{
 let schedules=0;const c=fixture(t,'cancel-race').controller;
 c.restart={status:()=>({supported:true}),schedule:()=>schedules++};
 const state=await c.start({autoRestart:true,workSaved:true});c.cancel(state.sessionId);
 await waitStatus(c,'completed');assert.equal(schedules,0);
});
