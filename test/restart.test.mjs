import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RestartController, launchRestartHelper} from '../src/restart.mjs';
import {readFileSync, existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('native helper accepts a JXA string count and rejects missing or multiple apps',()=>{
 const source=readFileSync(new URL('../src/restart-helper.js',import.meta.url),'utf8');
 for (const count of ['1',1,'0','2']) {
  let terminated=0,relaunched=0,refreshed=false;
  const path='/mock/Codex.app';
  const app={bundleURL:{path},get terminate(){terminated++;return true;},get isTerminated(){return refreshed;}};
  const bridge=Object.assign(value=>value,{
   NSBundle:{bundleWithPath:()=>({bundleIdentifier:'com.openai.codex',bundlePath:path})},
   NSRunningApplication:{runningApplicationsWithBundleIdentifier:()=>({count,objectAtIndex:()=>app})},
   NSThread:{sleepForTimeInterval:()=>{}},
   NSDate:{dateWithTimeIntervalSinceNow:value=>value},
   NSRunLoop:{currentRunLoop:{runUntilDate:()=>{refreshed=true;}}},
   NSTask:{alloc:{init:{get launch(){relaunched++;},get waitUntilExit(){},terminationStatus:0}}}
  });
  const context={$:bridge,ObjC:{import:()=>{},unwrap:value=>value}};
  runInNewContext(source,context);
  if(Number(count)===1) {
   context.run([path]);assert.equal(terminated,1);assert.equal(relaunched,1);
  } else {
   assert.throws(()=>context.run([path]),/Expected one running/);
   assert.equal(terminated,0);assert.equal(relaunched,0);
  }
 }
});

test('restart requires explicit confirmation and a supported target; never launches on read',()=>{
 let launches=0;
 const r=new RestartController({detect:()=>null,launch:()=>{launches++}});
 assert.equal(r.status().supported,false);
 assert.throws(()=>r.schedule(false));assert.throws(()=>r.schedule(true));
 assert.equal(launches,0);
});
test('countdown is idempotent and cancellation prevents helper dispatch',async()=>{
 let launches=0;
 const r=new RestartController({detect:()=>'/mock/Codex.app',launch:()=>{launches++;return new EventEmitter()},delayMs:40});
 const first=r.schedule(true);assert.equal(r.schedule(true).restartAt,first.restartAt);
 assert.equal(r.cancel().status,'cancelled');await delay(80);assert.equal(launches,0);
 r.schedule(true);r.close();await delay(80);assert.equal(launches,0);
});
test('helper is dispatched once and failures are not reported as successful restart',async()=>{
 const child=new EventEmitter();let launches=0;
 const r=new RestartController({detect:()=>'/mock/Codex.app',launch:path=>{assert.equal(path,'/mock/Codex.app');launches++;return child},delayMs:10});
 r.schedule(true);await delay(40);assert.equal(launches,1);assert.equal(r.status().status,'restarting');
 r.schedule(true);assert.equal(launches,1);assert.throws(()=>r.cancel());
 child.emit('exit',1);assert.equal(r.status().status,'failed');r.close();
});

test('restart is owned by a one-shot launchd job with safe arguments and cleaned staging',()=>{
 const child=new EventEmitter();let plist;
 const path='/mock/Codex & Friends.app';
 const result=launchRestartHelper(path,{spawnProcess:(command,args,options)=>{
  assert.equal(command,'/bin/launchctl');
  assert.equal(args[0],'bootstrap');
  assert.match(args[1],/^gui\/\d+$/);
  assert.equal(options.stdio,'ignore');
  plist=args[2];
  const xml=readFileSync(plist,'utf8');
  assert.match(xml,/<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml,/<key>KeepAlive<\/key><false\/>/);
  assert.ok(xml.includes('/mock/Codex &amp; Friends.app'));
  assert.ok(xml.includes('/bin/launchctl bootout'));
  return child;
 }});
 assert.equal(result,child);assert.equal(existsSync(plist),true);
 child.emit('exit',0);assert.equal(existsSync(plist),false);
});

test('helper refuses to reopen when graceful termination is declined',()=>{
 const source=readFileSync(new URL('../src/restart-helper.js',import.meta.url),'utf8');
 const path='/mock/Codex.app';let launched=false;
 const bridge=Object.assign(value=>value,{
  NSBundle:{bundleWithPath:()=>({bundleIdentifier:'com.openai.codex',bundlePath:path})},
  NSRunningApplication:{runningApplicationsWithBundleIdentifier:()=>({count:1,objectAtIndex:()=>({bundleURL:{path},terminate:false})})},
  NSThread:{sleepForTimeInterval:()=>{}},
  NSTask:{get alloc(){launched=true;throw Error('Unexpected launch');}}
 });
 const context={$:bridge,ObjC:{import:()=>{},unwrap:value=>value}};
 runInNewContext(source,context);
 assert.throws(()=>context.run([path]),/declined termination/);
 assert.equal(launched,false);
});
